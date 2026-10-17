"""RPC, proof and private signing adapters for the approved pool test phase."""
import hashlib
import http.client
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import uuid

import pool_plan as plan

SPEC = importlib.util.spec_from_file_location('old_deployment', Path(__file__).with_name('deploy-xlayer-test.py'))
old = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(old)
require, number, cast, save = plan.require, plan.number, plan.cast, old.save
ORACLE = old.ORACLE
IMPL_SHA = '7e49db5c1d54bab9a75a387dc972d4fb1c3c78f3fbf31336a9d8413d6d125cc3'
IMPL = '0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1'
READS = {'eth_chainId', 'eth_blockNumber', 'eth_gasPrice', 'eth_getCode', 'eth_getStorageAt',
         'eth_getBalance', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_call',
         'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_getTransactionByHash'}
OFFICIAL_READ_RPC = 'https://rpc.xlayer.tech'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def parallel(*functions):
    with ThreadPoolExecutor(max_workers=6) as workers:
        futures = [workers.submit(function) for function in functions]
        return [future.result() for future in futures]


class Chain:
    def __init__(self, url=plan.RPC_URL, *, execute=False, owned=None):
        self.url, self.execute, self.owned = url, execute, owned
        self.local = urllib.parse.urlparse(url).hostname == '127.0.0.1'
        require(self.local or url == plan.RPC_URL or (url == OFFICIAL_READ_RPC and not execute), 'Unapproved remote RPC')
        require(not self.local or owned is not None, 'Local mutations require an owned process')

    def rpc(self, method, params=()):
        if self.local:
            self.owned()
        elif method not in READS:
            require(self.execute and method == 'eth_sendRawTransaction', 'Remote mutation prohibited')
        request_id = str(uuid.uuid4())
        request = urllib.request.Request(self.url, json.dumps({'jsonrpc': '2.0', 'id': request_id,
            'method': method, 'params': list(params)}).encode(),
            {'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0', 'Cache-Control': 'no-cache'})
        # Retry only transport failures of idempotent reads. A broadcast response
        # loss always returns control to journal reconciliation instead.
        attempts = 3 if method in READS else 1
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(request, timeout=180 if self.local and method in ('eth_call', 'eth_estimateGas') else 30) as response:
                    result = json.load(response)
                break
            except (OSError, http.client.RemoteDisconnected):
                if attempt + 1 == attempts:
                    raise
                time.sleep(0.2 * (attempt + 1))
        require(result.get('id') == request_id, 'RPC response ID mismatch')
        if 'error' in result:
            # The provider may echo signed bytes in an error message; retain only its code.
            raise RuntimeError(f'{method} rejected (code {result["error"].get("code")})')
        return result['result']

    def call(self, to, signature=None, args=(), *, data=None, block='latest', sender=None, value=0):
        tx = {'to': to, 'data': data or plan.calldata(signature, *args)}
        if sender:
            tx.update({'from': sender, 'value': hex(value)})
        return self.rpc('eth_call', [tx, block])

    def words(self, to, signature, args=(), block='latest'):
        result = self.call(to, signature, args, block=block)[2:]
        require(len(result) % 64 == 0, 'Invalid ABI return length')
        return [int(result[i:i+64], 16) for i in range(0, len(result), 64)]

    def snapshot(self, config, block='latest'):
        owner = config['owner']
        values = parallel(lambda: number(self.rpc('eth_getBalance', [owner, block])),
                          lambda: number(self.call(plan.STABLE, 'balanceOf(address)', [owner], block=block)),
                          lambda: number(self.call(config['wrappedNative'], 'balanceOf(address)', [owner], block=block)))
        return dict(zip(('native', 'stable', 'wrapped'), values))


def oracle_gate(chain, unsigned_bytes, gas):
    block = chain.rpc('eth_blockNumber')
    word = chain.rpc('eth_getStorageAt', [ORACLE, old.IMPLEMENTATION_SLOT, block])
    impl = '0x' + word[-40:]
    require(impl.lower() == IMPL, 'Fee oracle implementation address changed')
    require(sha(bytes.fromhex(chain.rpc('eth_getCode', [impl, block])[2:])) == IMPL_SHA, 'Fee oracle implementation changed')
    fjord, isthmus, l1, operator, proxy = parallel(
        lambda: number(chain.call(ORACLE, 'isFjord()', block=block)),
        lambda: number(chain.call(ORACLE, 'isIsthmus()', block=block)),
        lambda: number(chain.call(ORACLE, 'getL1FeeUpperBound(uint256)', [unsigned_bytes], block=block)),
        lambda: number(chain.call(ORACLE, 'getOperatorFee(uint256)', [gas], block=block)),
        lambda: sha(bytes.fromhex(chain.rpc('eth_getCode', [ORACLE, block])[2:])))
    require(fjord == 1 and isthmus == 1, 'Unknown fee model')
    require(l1 == 0 and operator == 0, 'Nonzero additional fees require a fresh cost review')
    return {'address': impl.lower(), 'codeSha256': IMPL_SHA,
            'proxyCodeSha256': proxy}


def runtime_gate(chain, config, deployment_report, seed):
    require(number(chain.rpc('eth_chainId')) == plan.CHAIN, 'RPC chain mismatch')
    def verify_runtime(row):
        address = row['receipt'].get('contractAddress')
        if not address:
            return
        runtime = chain.rpc('eth_getCode', [address, 'latest'])
        require(sha(bytes.fromhex(runtime[2:])) == row['runtimeCodeSha256'], 'Deployed runtime differs from verified deployment')
    with ThreadPoolExecutor(max_workers=6) as workers:
        list(workers.map(verify_runtime, deployment_report['transactions']))
    seed_runtime = chain.rpc('eth_getCode', [seed['tx']['to'], 'latest'])
    require(seed_runtime != '0x' and sha(bytes.fromhex(seed_runtime[2:])) == seed['routerCodeSha256'], 'Seed router runtime changed')
    metadata = parallel(lambda: number(chain.call(plan.STABLE, 'decimals()')),
        lambda: number(chain.call(config['wrappedNative'], 'decimals()')),
        lambda: number(chain.call(config['contracts']['v3Factory'], 'feeAmountTickSpacing(uint24)', [100])),
        lambda: number(chain.call(config['contracts']['v4PoolManager'], 'protocolFeeController()')))
    require(metadata == [6, 18, 1, 0], 'Token decimals or pool fee bindings changed')


def make_unsigned(intent, owner, nonce, gas, price):
    return {'chainId': plan.CHAIN, 'from': owner, 'nonce': hex(nonce), 'to': intent['to'],
            'value': hex(intent['value']), 'data': intent['data'], 'gas': hex(gas), 'gasPrice': hex(price)}


def mktx(tx, *, sign=False, wallet=None):
    args = ['mktx', '--chain', plan.CHAIN, '--legacy', '--from', tx['from'], '--nonce', number(tx['nonce']),
            '--gas-limit', number(tx['gas']), '--gas-price', number(tx['gasPrice']), '--value', number(tx['value']),
            '--rpc-url', 'http://127.0.0.1:1']
    if sign:
        require(wallet is not None, 'Explicit local keystore required')
        args += ['--keystore', wallet / 'owner', '--password-file', wallet / 'password']
    else:
        args += ['--raw-unsigned']
    return cast(*args, tx['to'], tx['data'])


def validate_signed(row, decode=old.decoded, keccak=None):
    tx, actual = row['unsigned'], decode(row['raw'])
    require(actual.get('signer', '').lower() == tx['from'].lower(), 'Signed sender mismatch')
    for key in ('chainId', 'nonce', 'gas', 'value'):
        require(number(actual[key]) == number(tx[key]), f'Signed {key} mismatch')
    require(number(actual['chainId']) == plan.CHAIN and number(actual['type']) == 0, 'Signed chain/type mismatch')
    require(number(actual.get('gasPrice', actual.get('maxFeePerGas'))) == number(tx['gasPrice']), 'Signed gas price mismatch')
    require(actual['to'].lower() == tx['to'].lower() and actual['input'].lower() == tx['data'].lower(), 'Signed intent mismatch')
    require((keccak or (lambda raw: cast('keccak', raw)))(row['raw']).lower() == row['hash'].lower(), 'Signed hash mismatch')


def budgets(rows, remaining, *, balance=None):
    spent = sum(old.receipt_cost(row['receipt']) for row in rows if row.get('receipt'))
    pending = [row['unsigned'] for row in rows if not row.get('receipt')] + remaining
    reserve = sum(number(tx['gas']) * number(tx['gasPrice']) for tx in pending)
    require(spent + reserve <= plan.GAS_CAP, 'Approved gas budget exceeded')
    gross = sum(number(row['unsigned']['value']) for row in rows) + sum(number(tx['value']) for tx in remaining)
    require(gross <= plan.PRINCIPAL_CAP, 'Approved gross native principal exceeded')
    if balance is not None:
        require(balance >= reserve + sum(number(tx['value']) for tx in pending), 'Insufficient balance for remaining principal and gas caps')
    return {'gasSpentWei': spent, 'remainingGasCapWei': reserve, 'grossPrincipalWei': gross}


def receipt(chain, row):
    result = chain.rpc('eth_getTransactionReceipt', [row['hash']])
    if result is None or (not chain.local and number(chain.rpc('eth_blockNumber')) < number(result['blockNumber']) + 2):
        return None
    tx = row['unsigned']
    require(result['transactionHash'].lower() == row['hash'].lower(), 'Receipt hash mismatch')
    require(result['from'].lower() == tx['from'].lower() and result['to'].lower() == tx['to'].lower(), 'Receipt sender/destination mismatch')
    require(number(result['status']) == 1, 'Transaction reverted; journal retained, no automatic retry')
    require(number(result['gasUsed']) <= number(tx['gas']) and number(result['effectiveGasPrice']) == number(tx['gasPrice']), 'Receipt gas differs from signed cap')
    block = chain.rpc('eth_getBlockByNumber', [result['blockNumber'], False])
    require(block['hash'].lower() == result['blockHash'].lower(), 'Receipt block is not canonical')
    old.receipt_cost(result)
    require(number(chain.call(ORACLE, 'getOperatorFee(uint256)', [number(result['gasUsed'])], block=result['blockNumber'])) == 0,
            'Nonzero operator fee in receipt block')
    return result


def wait_receipt(chain, row, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = receipt(chain, row)
        if result:
            return result
        time.sleep(0.15 if chain.local else 1)
    raise RuntimeError('Transaction pending; resume the same private journal without replacing it')


def token_id(receipt_value, manager, owner):
    transfer = cast('keccak', 'Transfer(address,address,uint256)')
    ids = [int(log['topics'][3], 16) for log in receipt_value['logs']
           if log['address'].lower() == manager.lower() and len(log['topics']) == 4
           and log['topics'][0].lower() == transfer.lower()
           and int(log['topics'][1], 16) == 0 and int(log['topics'][2], 16) == int(owner, 16)]
    require(len(ids) == 1, 'Expected exactly one owner LP NFT mint')
    return ids[0]


def postcondition(chain, config, ctx, row):
    name, result = row['name'], row['receipt']
    block, c, owner = result['blockNumber'], config['contracts'], config['owner']
    after, before = chain.snapshot(config, block), row['before']
    delta = {asset: after[asset] - before[asset] for asset in before}
    native_without_gas = delta['native'] + old.receipt_cost(result)
    proof = {'after': after, 'stableDelta': delta['stable'], 'nativeDeltaExcludingGas': native_without_gas}
    if name in ('approveV3', 'approvePermit2', 'permitV4LP', 'permitRouter'):
        require(delta['stable'] == 0 and native_without_gas == 0, 'Approval unexpectedly moved owner assets')
    if name == 'seed':
        require(delta['stable'] >= row['intent']['minOutput'] and native_without_gas == -plan.BUY, 'Seed did not deliver the approved native/stable exchange')
    elif name in ('approveV3', 'approvePermit2'):
        spender = c['v3PositionManager'] if name == 'approveV3' else config['permit2']
        require(number(chain.call(plan.STABLE, 'allowance(address,address)', [owner, spender], block=block)) == row['intent']['approvalAmount'], 'ERC20 allowance differs from finite approval')
    elif name in ('permitV4LP', 'permitRouter'):
        spender = c['v4PositionManager'] if name == 'permitV4LP' else c['universalRouter']
        allowance = chain.words(config['permit2'], 'allowance(address,address,address)', [owner, plan.STABLE, spender], block)
        require(allowance[0] == row['intent']['approvalAmount'] and allowance[1] == row['intent']['deadline'], 'Permit2 allowance differs from finite approval')
    elif name in ('mintV3', 'mintV4'):
        manager = c['v3PositionManager'] if name == 'mintV3' else c['v4PositionManager']
        token = token_id(result, manager, owner)
        require(number(chain.call(manager, 'ownerOf(uint256)', [token], block=block)) == int(owner, 16), 'LP NFT owner mismatch')
        require(-plan.LP_NATIVE <= native_without_gas < 0 and -ctx['stableCap'] <= delta['stable'] < 0, 'LP asset use exceeds caps or is zero')
        if name == 'mintV3':
            pool = chain.call(c['v3Factory'], 'getPool(address,address,uint24)', [plan.STABLE, config['wrappedNative'], 100], block=block)
            address = '0x' + pool[-40:]
            require(int(address, 16) != 0, 'Missing V3 pool')
            require(chain.words(address, 'slot0()', block=block)[0] == ctx['sqrt3'], 'V3 initialization price mismatch')
            require(number(chain.call(address, 'liquidity()', block=block)) > 0, 'V3 pool has zero liquidity')
            position = chain.words(manager, 'positions(uint256)', [token], block)
            require(position[2] == int(plan.STABLE, 16) and position[3] == int(config['wrappedNative'], 16)
                    and position[4] == 100 and position[5] == plan.LOWER % (1 << 256)
                    and position[6] == plan.UPPER and position[7] == ctx['lp3']['liquidity'],
                    'V3 position token/fee/range/liquidity mismatch')
            initialized = cast('keccak', 'Initialize(uint160,int24)')
            require(any(log['address'].lower() == address.lower() and log['topics'][0] == initialized for log in result['logs']), 'V3 Initialize event missing')
            proof.update({'poolAddress': address, 'tokenId': token, 'liquidity': position[7]})
        else:
            pool = plan.pool_id(config)
            slot = chain.words(c['v4StateView'], 'getSlot0(bytes32)', [pool], block)
            require(slot[0] == ctx['sqrt4'] and slot[2] == 0 and slot[3] == 0, 'V4 initialization price/fees mismatch')
            liquidity = number(chain.call(manager, 'getPositionLiquidity(uint256)', [token], block=block))
            require(liquidity == ctx['lp4']['liquidity'] and liquidity > 0, 'V4 position liquidity mismatch')
            pool_info = chain.words(manager, 'getPoolAndPositionInfo(uint256)', [token], block)
            require(pool_info[:5] == [0, int(plan.STABLE, 16), 0, 1, 0], 'V4 position pool key mismatch')
            initialized = cast('keccak', 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
            require(any(log['address'].lower() == c['v4PoolManager'].lower() and log['topics'][0] == initialized
                        and log['topics'][1].lower() == pool.lower() for log in result['logs']), 'V4 Initialize event missing')
            proof.update({'poolId': pool, 'tokenId': token, 'liquidity': liquidity})
    else:
        forward = name.endswith('Forward')
        minimum = row['intent']['minOutput']
        if forward:
            require(-plan.FORWARD <= native_without_gas < 0 and delta['stable'] >= minimum, 'Forward swap assets/minimum mismatch')
        else:
            require(-plan.REVERSE <= delta['stable'] < 0 and native_without_gas >= minimum, 'Reverse swap assets/minimum mismatch')
        v4 = name.startswith('v4')
        event = 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)' if v4 else 'Swap(address,address,int256,int256,uint160,uint128,int24)'
        topic = cast('keccak', event)
        expected_address = c['v4PoolManager'] if v4 else '0x' + chain.call(c['v3Factory'], 'getPool(address,address,uint24)', [plan.STABLE, config['wrappedNative'], 100], block=block)[-40:]
        logs = [log for log in result['logs'] if log['address'].lower() == expected_address.lower() and log['topics'][0].lower() == topic.lower()]
        require(len(logs) == 1 and (not v4 or logs[0]['topics'][1].lower() == plan.pool_id(config).lower()), 'Expected own-pool Swap event missing')
        event_data = logs[0]['data'][2:]
        amounts = [int(event_data[i:i+64], 16) for i in (0, 64)]
        amounts = [value - (1 << 256) if value >= (1 << 255) else value for value in amounts]
        expected = [native_without_gas, delta['stable']] if v4 else [-delta['stable'], -native_without_gas]
        require(amounts == expected, 'Swap event signed amounts differ from actual owner balances')
        proof['swapEvent'] = logs[0]
    require(delta['wrapped'] == 0, 'Unexpected owner wrapped-native residue')
    def no_residue(address):
        values = parallel(lambda: number(chain.rpc('eth_getBalance', [address, block])),
            lambda: number(chain.call(config['wrappedNative'], 'balanceOf(address)', [address], block=block)),
            lambda: number(chain.call(plan.STABLE, 'balanceOf(address)', [address], block=block)))
        require(values == [0, 0, 0], 'Unrefunded native or token currency in operation contract')
    parallel(*(lambda a=address: no_residue(a) for address in (c['universalRouter'], c['v3PositionManager'], c['v4PositionManager'])))
    return proof

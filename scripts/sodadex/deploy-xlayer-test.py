#!/usr/bin/env python3
"""Deploy the authorized chain-196 test plan, with a private resumable journal."""

import argparse
from decimal import Decimal
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('rehearsal', Path(__file__).with_name('rehearse-xlayer-test.py'))
rehearsal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rehearsal)
RPC = 'https://rpc.ignix.bot/rpc/196'
ORACLE = '0x420000000000000000000000000000000000000F'
# keccak256("eip1967.proxy.implementation") - 1
IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
WALLET = Path.home() / '.local/share/sodadex/wallets/xlayer-test-owner'
STATE = Path.home() / '.local/share/sodadex/deployments/xlayer-test'
BUDGET = 10**15


def require(condition, message):
    if not condition:
        raise ValueError(message)


def quantity(value):
    return int(value, 0) if isinstance(value, str) else int(value)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def cast(*args):
    result = subprocess.run(['cast', *map(str, args)], capture_output=True, text=True)
    # Do not include subprocess arguments/output: they may contain a signed transaction.
    if result.returncode:
        raise RuntimeError(f'cast {args[0]} failed; no transaction data logged')
    return result.stdout.strip()


def rpc(method, params=()):
    request_id = str(uuid.uuid4())
    request = urllib.request.Request(RPC, json.dumps({
        'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': list(params),
    }).encode(), {'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    require(data.get('id') == request_id, 'RPC response ID mismatch')
    if 'error' in data:
        raise RuntimeError(f'{method} rejected (code {data["error"].get("code")}); journal retained')
    return data['result']


def save(path, value):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def mktx(row, owner, *, sign=False):
    tx = row['unsigned']
    args = ['mktx', '--chain', '196', '--legacy', '--from', owner,
            '--nonce', quantity(tx['nonce']), '--gas-limit', quantity(tx['gas']),
            '--gas-price', row['gasPriceWei'], '--value', '0', '--rpc-url', 'http://127.0.0.1:1']
    if sign:
        args += ['--keystore', WALLET / 'owner', '--password-file', WALLET / 'password']
    else:
        args += ['--raw-unsigned']
    args += [tx['to'], tx['data']] if tx.get('to') else ['--create', tx['data']]
    return cast(*args)


def decoded(raw):
    value = cast('decode-transaction', raw)
    # Foundry's display layer can JSON-wrap its structured transaction output.
    for _ in range(4):
        if not isinstance(value, str):
            break
        value = json.loads(value)
    require(isinstance(value, dict), 'Unrecognized signed transaction format')
    return value


def validate_signed(row, owner, decode=decoded, keccak=None):
    tx, actual = row['unsigned'], decode(row['raw'])
    require(actual.get('signer', '').lower() == owner.lower(), 'Signed sender mismatch')
    for key, expected in [('chainId', 196), ('nonce', quantity(tx['nonce'])),
                          ('gas', quantity(tx['gas'])), ('value', 0), ('type', 0)]:
        require(quantity(actual[key]) == expected, f'Signed {key} mismatch')
    require(quantity(actual.get('gasPrice', actual.get('maxFeePerGas'))) == row['gasPriceWei'], 'Signed gas price mismatch')
    require((actual.get('to') or '').lower() == (tx.get('to') or '').lower(), 'Signed destination mismatch')
    require(actual['input'].lower() == tx['data'].lower(), 'Signed calldata mismatch')
    computed = (keccak or (lambda raw: cast('keccak', raw)))(row['raw'])
    require(computed.lower() == row['hash'].lower(), 'Signed hash mismatch')


def validate_preparation(config, prepared):
    require(config['phase'] == 'test' and config['chainId'] == 196 and config['rpcUrl'] == RPC, 'Wrong deployment target')
    require(Decimal(config['gasBudgetOKB']) * 10**18 == BUDGET, 'Budget changed')
    require(config['requestedFees'] == {
        'interfaceFeeBps': 0, 'protocolFee': 0, 'v3PoolFee': 100, 'v3TickSpacing': 1,
        'v4PoolFee': 0, 'v4Hooks': rehearsal.ZERO,
    }, 'Fee plan changed')
    require(prepared['chainId'] == 196 and prepared['status'].startswith('localhost-rehearsal-passed'), 'Missing successful rehearsal')
    sources = ROOT / '.analysis/upstream'
    router = sources / 'universal-router-2.1.2'
    for folder, key in [(router, 'universalRouter'), (router / 'lib/v4-periphery', 'v4Periphery'),
                        (router / 'lib/v4-periphery/lib/v4-core', 'v4Core')]:
        require(rehearsal.command('git', 'rev-parse', 'HEAD', cwd=folder) == config['versions'][key], 'Source revision changed')
        require(not rehearsal.command('git', 'status', '--porcelain', '--untracked-files=no', cwd=folder), 'Source modified')
    rows = prepared['transactions']
    require(len(rows) == 13, 'Expected twelve deployments and one fee configuration')
    cursor = 0

    def verify(name, data, to=None, source=None):
        nonlocal cursor
        row = rows[cursor]
        tx = row['unsigned']
        nonce = prepared['ownerNonce'] + cursor
        require(row['name'] == name and tx['from'].lower() == config['owner'].lower(), 'Intent owner/name mismatch')
        require(tx['chainId'] == 196 and quantity(tx['value']) == 0 and quantity(tx['nonce']) == nonce, 'Intent chain/value/nonce mismatch')
        require(tx['data'].lower() == data.lower() and (tx.get('to') or '').lower() == (to or '').lower(), 'Intent calldata/destination mismatch')
        used = quantity(row['localReceipt']['gasUsed'])
        require(quantity(tx['gas']) == used + used // 10, 'Unexpected gas margin')
        if source:
            require(row['artifact']['sha256'] == source['sha256'], 'Artifact file changed')
            predicted = cast('compute-address', config['owner'], '--nonce', nonce)
            address = re.search(r'0x[0-9a-fA-F]{40}', predicted)[0]
            require(address.lower() == row['localReceipt']['contractAddress'].lower(), 'CREATE address mismatch')
            require(re.fullmatch('[0-9a-f]{64}', row.get('runtimeCodeSha256') or '') is not None, 'Missing rehearsal runtime hash')
        else:
            address = None
        cursor += 1
        return address

    def deploy(name, path, ctor, libraries):
        source = rehearsal.artifact(path)
        require(source['bytecodeSha256'] == config['artifactBytecodeSha256'][source['name']], 'Artifact creation bytecode changed')
        return verify(name, rehearsal.initcode(source, ctor, libraries), source=source)

    addresses = rehearsal.deployment_steps(config, sources, deploy, verify)
    require(cursor == 13, 'Incomplete deployment plan')
    return addresses


def call(address, signature, args=(), block='latest'):
    data = cast('calldata', signature, *args)
    return rpc('eth_call', [{'to': address, 'data': data}, block])


def receipt_cost(receipt):
    # This executor supports only the verified zero-additional-fee configuration.
    for field in ('l1Fee', 'operatorFee', 'operatorFeeScalar', 'operatorFeeConstant'):
        require(quantity(receipt.get(field, '0x0')) == 0, 'Receipt additional fees changed; stop before the next transaction')
    return quantity(receipt['gasUsed']) * quantity(receipt['effectiveGasPrice'])


def budget_check(rows, budget=BUDGET):
    spent = sum(receipt_cost(row['receipt']) for row in rows if row.get('receipt'))
    reserved = sum(quantity(row['unsigned']['gas']) * row['gasPriceWei'] for row in rows if not row.get('receipt'))
    require(spent + reserved <= budget, 'Deployment would exceed the approved total budget')
    return spent, reserved


def validate_rows(journal):
    expected = journal['prepared']['transactions']
    require(len(journal['rows']) == len(expected), 'Journal transaction count changed')
    for row, original in zip(journal['rows'], expected):
        require(all(row.get(key) == original.get(key) for key in
                    ('name', 'unsigned', 'localReceipt', 'artifact', 'runtimeCodeSha256')),
                'Journal intents changed')


def nonce_gate(latest, pending, expected):
    require(latest == pending == expected, 'Unknown nonce occupancy; journal preserved')


def broadcast_saved(path, journal, row, send=rpc):
    save(path, journal)
    returned = send('eth_sendRawTransaction', [row['raw']])
    require(returned.lower() == row['hash'].lower(), 'Broadcast returned a different hash')
    row['broadcastAt'] = time.time()
    save(path, journal)


def oracle_implementation(block='latest'):
    word = rpc('eth_getStorageAt', [ORACLE, IMPLEMENTATION_SLOT, block])
    require(isinstance(word, str) and re.fullmatch(r'0x[0-9a-fA-F]{64}', word), 'Invalid oracle implementation slot')
    address = '0x' + word[-40:]
    code = rpc('eth_getCode', [address, block])
    require(code != '0x', 'Missing oracle implementation code')
    return {'address': address.lower(), 'codeSha256': sha(bytes.fromhex(code[2:]))}


def live_gate(config, journal):
    require(quantity(rpc('eth_chainId')) == 196, 'RPC chain mismatch')
    block = rpc('eth_blockNumber')
    code = rpc('eth_getCode', [ORACLE, block])
    require(code != '0x' and sha(bytes.fromhex(code[2:])) == journal['oracleCodeSha256'], 'Fee oracle implementation changed')
    require(oracle_implementation(block) == journal['oracleImplementation'], 'Fee oracle proxy implementation changed')
    remaining = [row for row in journal['rows'] if not row.get('receipt')]
    if remaining:
        require(quantity(rpc('eth_gasPrice')) <= min(row['gasPriceWei'] for row in remaining), 'Gas price increased; signed cap retained')
        require(quantity(call(ORACLE, 'isFjord()', block=block)) == 1, 'Unknown data fee model')
        require(quantity(call(ORACLE, 'isIsthmus()', block=block)) == 1, 'Unknown operator fee model')
        l1 = quantity(call(ORACLE, 'getL1FeeUpperBound(uint256)', [str(max(row['unsignedBytes'] for row in remaining))], block))
        operator = quantity(call(ORACLE, 'getOperatorFee(uint256)', [str(max(quantity(row['unsigned']['gas']) for row in remaining))], block))
        require(l1 == 0 and operator == 0, 'Nonzero additional fees require a fresh complete cost review')
    spent, reserved = budget_check(journal['rows'])
    balance = quantity(rpc('eth_getBalance', [config['owner'], 'latest']))
    require(balance >= reserved, 'Target-chain native balance is insufficient')
    return {'block': quantity(block), 'balanceWei': str(balance), 'spentWei': str(spent), 'remainingExecutionCapWei': str(reserved)}


def check_receipt(row, config):
    receipt = rpc('eth_getTransactionReceipt', [row['hash']])
    if not receipt:
        return None
    # Sequencer preconfirmations can expose a receipt before the block header settles.
    if quantity(rpc('eth_blockNumber')) < quantity(receipt['blockNumber']) + 2:
        return None
    require(receipt['transactionHash'].lower() == row['hash'].lower(), 'Receipt transaction hash mismatch')
    require(receipt['from'].lower() == config['owner'].lower(), 'Receipt sender mismatch')
    require(quantity(receipt['status']) == 1, f'{row["name"]} reverted; do not redeploy automatically')
    expected = row['localReceipt'].get('contractAddress')
    require((receipt.get('contractAddress') or '').lower() == (expected or '').lower(), 'Receipt contract address mismatch')
    require((receipt.get('to') or '').lower() == (row['unsigned'].get('to') or '').lower(), 'Receipt destination mismatch')
    require(quantity(receipt['gasUsed']) <= quantity(row['unsigned']['gas']), 'Receipt gas exceeds signed cap')
    require(quantity(receipt['effectiveGasPrice']) == row['gasPriceWei'], 'Unexpected receipt gas price')
    block = rpc('eth_getBlockByNumber', [receipt['blockNumber'], False])
    require(block and block['hash'].lower() == receipt['blockHash'].lower(), 'Receipt no longer canonical')
    receipt_cost(receipt)
    require(quantity(call(ORACLE, 'getOperatorFee(uint256)', [str(quantity(receipt['gasUsed']))], receipt['blockNumber'])) == 0,
            'Operator fee changed in the receipt block')
    if expected:
        runtime = rpc('eth_getCode', [expected, receipt['blockNumber']])
        require(sha(bytes.fromhex(runtime[2:])) == row['runtimeCodeSha256'], f'{row["name"]} runtime differs from rehearsal')
    return receipt


def reconcile_saved(path, journal, config):
    """Recover receipts before evaluating the remaining balance or gas quote."""
    for row in journal['rows']:
        require(not row.get('receipt') or row.get('raw'), 'Receipt without a signed journal entry')
        if not row.get('raw'):
            continue
        validate_signed(row, config['owner'])
        receipt = check_receipt(row, config)
        require(receipt is not None or not row.get('receipt'), 'Previously confirmed transaction lost its receipt')
        if receipt:
            row['receipt'] = receipt
            budget_check(journal['rows'])
            save(path, journal)


def observed_spend(config, journal):
    balance = quantity(rpc('eth_getBalance', [config['owner'], 'latest']))
    observed = quantity(journal['initialGate']['balanceWei']) - balance
    require(observed <= BUDGET, 'Observed wallet spend exceeds approved budget')
    return balance, observed


def binding_checks(config, addresses):
    d, w, p = addresses, config['wrappedNative'], config['permit2']
    checks = [
        ('v3Factory', 'owner()', config['owner']), ('v4PoolManager', 'owner()', config['owner']),
        ('v4PoolManager', 'protocolFeeController()', rehearsal.ZERO),
        ('v3TokenDescriptor', 'WETH9()', w), ('v3TokenDescriptor', 'nativeCurrencyLabelBytes()', '0x' + b'OKB'.hex().ljust(64, '0')),
        ('v3PositionManager', 'factory()', d['v3Factory']), ('v3PositionManager', 'WETH9()', w),
        ('v3Quoter', 'factory()', d['v3Factory']), ('v3Quoter', 'WETH9()', w),
        ('v4Descriptor', 'poolManager()', d['v4PoolManager']), ('v4Descriptor', 'wrappedNative()', w),
        ('v4PositionManager', 'poolManager()', d['v4PoolManager']), ('v4PositionManager', 'permit2()', p),
        ('v4PositionManager', 'WETH9()', w), ('v4PositionManager', 'tokenDescriptor()', d['v4Descriptor']),
        ('v4PositionManager', 'unsubscribeGasLimit()', hex(config['v4UnsubscribeGasLimit'])),
        ('v4Quoter', 'poolManager()', d['v4PoolManager']), ('v4StateView', 'poolManager()', d['v4PoolManager']),
        ('universalRouter', 'poolManager()', d['v4PoolManager']),
        ('universalRouter', 'V3_POSITION_MANAGER()', d['v3PositionManager']),
        ('universalRouter', 'V4_POSITION_MANAGER()', d['v4PositionManager']),
        ('universalRouter', 'SPOKE_POOL()', d['unsupportedProtocol']),
    ]
    for name, signature, expected in checks:
        require(quantity(call(d[name], signature)) == int(expected, 16), f'{name}.{signature} binding mismatch')
    require(quantity(call(d['v3Factory'], 'feeAmountTickSpacing(uint24)', ['100'])) == 1, 'V3 0.01% tier missing')
    return len(checks) + 1


def run(args):
    config_path = ROOT / 'deployments/xlayer-test/plan.json'
    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not STATE.is_symlink(), 'State directory cannot be a symlink')
    os.chmod(STATE, 0o700)
    with (STATE / 'lock').open('a') as lock:
        os.chmod(STATE / 'lock', 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = STATE / 'journal.json'
        signer = cast('wallet', 'address', '--keystore', WALLET / 'owner', '--password-file', WALLET / 'password')
        require(signer.lower() == config['owner'].lower(), 'Keystore owner mismatch')
        if path.exists():
            require(not path.is_symlink() and path.stat().st_mode & 0o077 == 0, 'Journal permissions invalid')
            journal = json.loads(path.read_text())
            require(journal['configSha256'] == sha(config_bytes), 'Plan changed after preparation; journal preserved')
            if 'oracleImplementation' not in journal:
                require(not any(row.get('raw') for row in journal['rows']), 'Signed journal lacks implementation evidence')
                journal['oracleImplementation'] = oracle_implementation()
                save(path, journal)
        else:
            require(not config['contracts'], 'Plan already deployed')
            latest = quantity(rpc('eth_getTransactionCount', [signer, 'latest']))
            require(latest == quantity(rpc('eth_getTransactionCount', [signer, 'pending'])), 'Unknown pending owner transaction')
            prepared = json.loads(args.rehearsal.read_text())
            require(prepared['ownerNonce'] == latest, 'Rehearsal starting nonce is stale')
            require(0 <= quantity(rpc('eth_blockNumber')) - prepared['sourceBlock'] <= 600, 'Rehearsal is stale')
            validate_preparation(config, prepared)
            gas_price = quantity(rpc('eth_gasPrice'))
            rows = json.loads(json.dumps(prepared['transactions']))
            for row in rows:
                row['gasPriceWei'] = gas_price
                row['unsignedBytes'] = len(bytes.fromhex(mktx(row, signer)[2:]))
            oracle = rpc('eth_getCode', [ORACLE, 'latest'])
            journal = {'configSha256': sha(config_bytes), 'prepared': prepared, 'rows': rows,
                       'oracleCodeSha256': sha(bytes.fromhex(oracle[2:])),
                       'oracleImplementation': oracle_implementation(), 'createdAt': time.time()}
            journal['initialGate'] = live_gate(config, journal)
            save(path, journal)
        addresses = validate_preparation(config, journal['prepared'])
        validate_rows(journal)
        reconcile_saved(path, journal, config)
        observed_spend(config, journal)
        unresolved = [row for row in journal['rows'] if row.get('raw') and not row.get('receipt')]
        gate = {'pendingSignedTransactions': len(unresolved)} if unresolved else live_gate(config, journal)
        print(json.dumps({'owner': signer, 'chainId': 196, 'gate': gate, 'budgetOKB': '0.001', 'broadcast': args.broadcast}), flush=True)
        if not args.broadcast:
            return
        for row in journal['rows']:
            if row.get('receipt'):
                # All saved receipts were just reconciled; final verification repeats it.
                continue
            if row.get('raw'):
                validate_signed(row, signer)
                receipt = check_receipt(row, config)
                if receipt:
                    row['receipt'] = receipt
                    save(path, journal)
                    continue
                require(not row.get('receipt'), 'Previously confirmed transaction lost its receipt')
            expected_nonce = quantity(row['unsigned']['nonce'])
            known = rpc('eth_getTransactionByHash', [row['hash']]) if row.get('hash') else None
            latest = quantity(rpc('eth_getTransactionCount', [signer, 'latest']))
            pending = quantity(rpc('eth_getTransactionCount', [signer, 'pending']))
            if not known:
                live_gate(config, journal)
                nonce_gate(latest, pending, expected_nonce)
                if not row.get('raw'):
                    row['raw'] = mktx(row, signer, sign=True)
                    row['hash'] = cast('keccak', row['raw'])
                    validate_signed(row, signer)
                    save(path, journal)  # Durable signed bytes/hash before the network write.
                require(quantity(call(ORACLE, 'getL1Fee(bytes)', [row['raw']])) == 0, 'Nonzero signed-transaction data fee')
                broadcast_saved(path, journal, row)
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                receipt = check_receipt(row, config)
                if receipt:
                    row['receipt'] = receipt
                    budget_check(journal['rows'])
                    save(path, journal)
                    observed_spend(config, journal)
                    print(json.dumps({'name': row['name'], 'hash': row['hash'], 'address': receipt.get('contractAddress'), 'gasUsed': quantity(receipt['gasUsed'])}), flush=True)
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Transaction pending; resume the same journal without replacing it')
        last = max(quantity(row['receipt']['blockNumber']) for row in journal['rows'])
        deadline = time.monotonic() + 60
        while quantity(rpc('eth_blockNumber')) < last + 2:
            require(time.monotonic() < deadline, 'Waiting for confirmation depth; resume journal')
            time.sleep(1)
        for row in journal['rows']:
            require(check_receipt(row, config) is not None, 'Receipt missing at final verification')
        checks = binding_checks(config, addresses)
        spent, _ = budget_check(journal['rows'])
        balance, observed = observed_spend(config, journal)
        report = {'name': 'SodaDex Test', 'status': 'deployed-and-verified', 'chainId': 196,
                  'rpcUrl': RPC, 'owner': signer, 'contracts': addresses, 'budgetOKB': '0.001',
                  'executorSourceCommit': rehearsal.command('git', 'rev-parse', 'HEAD', cwd=ROOT),
                  'executorSha256': sha(Path(__file__).read_bytes()),
                  'receiptCostOKB': str(Decimal(spent) / 10**18),
                  'observedBalanceDecreaseOKB': str(Decimal(observed) / 10**18),
                  'remainingBalanceOKB': str(Decimal(balance) / 10**18), 'bindingChecksPassed': checks,
                  'pool': None, 'productionDeployment': 'deferred',
                  'transactions': [{k: row[k] for k in ('name', 'hash', 'receipt', 'runtimeCodeSha256')} for row in journal['rows']]}
        report_path = ROOT / 'deployments/xlayer-test/receipts.json'
        save(report_path, report)
        journal['completed'] = True
        save(path, journal)
        print(json.dumps({k: v for k, v in report.items() if k != 'transactions'}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', type=Path, default=ROOT / '.analysis/deployment/xlayer-test-runtime-rehearsal.json')
    parser.add_argument('--broadcast', action='store_true', help='Execute only after explicit deployment authorization')
    try:
        run(parser.parse_args())
    except Exception as error:
        # Never emit tracebacks containing signed-transaction subprocess arguments.
        print(f'Deployment stopped: {type(error).__name__}: {error}')
        raise SystemExit(1) from None

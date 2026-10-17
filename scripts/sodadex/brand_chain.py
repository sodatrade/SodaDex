"""Chain proofs and private transaction adapter for the branding continuation."""
import base64
import json
import re
import time

import brand_plan as plan
import pool_chain as base
import pool_plan as pool

Chain, parallel, save, sha, old = base.Chain, base.parallel, base.save, base.sha, base.old
require, number, cast = pool.require, pool.number, pool.cast
oracle_gate, OFFICIAL_READ_RPC = base.oracle_gate, base.OFFICIAL_READ_RPC


def make_unsigned(intent, owner, nonce, gas, price):
    return {'chainId': pool.CHAIN, 'from': owner, 'nonce': hex(nonce), 'to': intent.get('to'),
            'value': hex(intent['value']), 'data': intent['data'], 'gas': hex(gas), 'gasPrice': hex(price)}


def mktx(tx, *, sign=False, wallet=None):
    args = ['mktx', '--chain', pool.CHAIN, '--legacy', '--from', tx['from'], '--nonce', number(tx['nonce']),
            '--gas-limit', number(tx['gas']), '--gas-price', number(tx['gasPrice']), '--value', number(tx['value']),
            '--rpc-url', 'http://127.0.0.1:1']
    if sign:
        require(wallet is not None, 'Explicit local keystore required')
        args += ['--keystore', wallet / 'owner', '--password-file', wallet / 'password']
    else:
        args += ['--raw-unsigned']
    args += [tx['to'], tx['data']] if tx.get('to') else ['--create', tx['data']]
    return cast(*args)


def validate_signed(row, decode=old.decoded, keccak=None):
    tx, actual = row['unsigned'], decode(row['raw'])
    require(actual.get('signer', '').lower() == tx['from'].lower(), 'Signed sender mismatch')
    for key in ('chainId', 'nonce', 'gas', 'value'):
        require(number(actual[key]) == number(tx[key]), f'Signed {key} mismatch')
    require(number(actual['chainId']) == pool.CHAIN and number(actual['type']) == 0, 'Signed chain/type mismatch')
    require(number(actual.get('gasPrice', actual.get('maxFeePerGas'))) == number(tx['gasPrice']), 'Signed gas price mismatch')
    require((actual.get('to') or '').lower() == (tx.get('to') or '').lower()
            and actual['input'].lower() == tx['data'].lower(), 'Signed destination/calldata mismatch')
    require((keccak or (lambda raw: cast('keccak', raw)))(row['raw']).lower() == row['hash'].lower(), 'Signed hash mismatch')


def receipt(chain, row):
    result = chain.rpc('eth_getTransactionReceipt', [row['hash']])
    if result is None or (not chain.local and number(chain.rpc('eth_blockNumber')) < number(result['blockNumber']) + 2):
        return None
    tx = row['unsigned']
    require(result['transactionHash'].lower() == row['hash'].lower(), 'Receipt hash mismatch')
    require(result['from'].lower() == tx['from'].lower()
            and (result.get('to') or '').lower() == (tx.get('to') or '').lower(), 'Receipt sender/destination mismatch')
    require(number(result['status']) == 1, 'Transaction reverted; no automatic replacement')
    require(number(result['gasUsed']) <= number(tx['gas'])
            and number(result['effectiveGasPrice']) == number(tx['gasPrice']), 'Receipt gas differs from signed cap')
    block = chain.rpc('eth_getBlockByNumber', [result['blockNumber'], False])
    require(block['hash'].lower() == result['blockHash'].lower(), 'Receipt block is not canonical')
    require((result.get('contractAddress') or '').lower() == row['intent'].get('expectedAddress', '').lower(), 'CREATE address mismatch')
    old.receipt_cost(result)
    require(number(chain.call(old.ORACLE, 'getOperatorFee(uint256)', [number(result['gasUsed'])], block=result['blockNumber'])) == 0,
            'Nonzero operator fee in receipt block')
    return result


def wait_receipt(chain, row, seconds=180):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        result = receipt(chain, row)
        if result:
            return result
        time.sleep(0.15 if chain.local else 1)
    raise RuntimeError('Transaction pending; resume retained journal, do not replace it')


def prior_gate(chain, original, deployment, prior):
    require(prior['status'] == 'interrupted-before-pool-creation-for-sodadex-rebrand'
            and prior['chainId'] == pool.CHAIN and prior['owner'].lower() == original['owner'].lower()
            and prior['confirmedNonce'] == prior['pendingNonce'] == 16, 'Wrong interrupted phase evidence')
    require(tuple(row['name'] for row in prior['transactions']) == plan.PRIOR_NAMES, 'Unexpected prior transaction set')
    require(prior['balances']['stable'] == 11844 and prior['balances']['wrapped'] == 0, 'Prior seed balance mismatch')
    for index, row in enumerate(prior['transactions']):
        require(number(row['unsigned']['nonce']) == 13 + index and number(row['unsigned']['chainId']) == pool.CHAIN,
                'Prior chain/nonce changed')
        require(number(row['unsigned']['value']) == (pool.BUY if index == 0 else 0), 'Prior principal changed')
        wrapped = {**row, 'intent': {'expectedAddress': ''}}
        canonical = receipt(chain, wrapped)
        require(canonical is not None and canonical['blockHash'].lower() == row['receipt']['blockHash'].lower(), 'Prior receipt moved')
        tx = chain.rpc('eth_getTransactionByHash', [row['hash']])
        require(tx and tx['from'].lower() == original['owner'].lower()
                and tx['to'].lower() == row['unsigned']['to'].lower()
                and tx['input'].lower() == row['unsigned']['data'].lower()
                and number(tx['value']) == number(row['unsigned']['value'])
                and number(tx['nonce']) == 13 + index, 'Prior transaction intent mismatch')
        require(old.receipt_cost(canonical) == old.receipt_cost(row['receipt']), 'Prior receipt fee changed')
    total = sum(old.receipt_cost(row['receipt']) for row in prior['transactions'])
    require(total == 7084791000000 and prior['budget']['gasSpentWei'] == total, 'Prior gas accounting changed')
    seed = {'tx': prior['transactions'][0]['unsigned'],
            'routerCodeSha256': '4e884ab2966a335f3462791c91acc1819a2209ec2ace1716e3498463ccb0a1ce'}
    base.runtime_gate(chain, original, deployment, seed)
    return total


def runtime_matches_artifact(code, artifact, libraries, *, library_address=None):
    expected = artifact['runtime']
    if library_address is not None:
        # solc 0.7.6 library creation writes ADDRESS into the PUSH20 guard.
        # This self-address patch has no immutable/link reference in the artifact.
        require(expected.startswith('73' + '00' * 20 + '3014'), 'Unknown library runtime self-address guard')
        expected = expected[:2] + library_address[2:].lower() + expected[42:]
    for names in artifact['runtimeLinks'].values():
        for name, refs in names.items():
            require(name in libraries, 'Unknown runtime library')
            for ref in refs:
                require(ref['length'] == 20, 'Unexpected runtime library length')
                start = 2 * ref['start']
                expected = expected[:start] + libraries[name][2:] + expected[start + 40:]
    actual = code.removeprefix('0x')
    require(len(actual) == len(expected) and actual, 'Runtime length mismatch')
    for refs in artifact['immutableReferences'].values():
        for ref in refs:
            start, size = 2 * ref['start'], 2 * ref['length']
            require(start + size <= len(expected), 'Immutable reference out of bounds')
            actual = actual[:start] + '0' * size + actual[start + size:]
            expected = expected[:start] + '0' * size + expected[start + size:]
    require(actual.lower() == expected.lower(), 'Runtime differs outside constructor immutable references')


def abi_string(raw):
    data = bytes.fromhex(raw.removeprefix('0x'))
    require(len(data) >= 64, 'Invalid ABI string')
    offset = int.from_bytes(data[:32], 'big')
    size = int.from_bytes(data[offset:offset + 32], 'big')
    require(offset % 32 == 0 and offset + 32 + size <= len(data), 'ABI string exceeds result')
    return data[offset + 32:offset + 32 + size].decode('utf-8')


def brand_bindings(chain, config, *, block='latest'):
    c, w, p = config['contracts'], config['wrappedNative'], config['permit2']
    checks = [('v3PositionManager', 'factory()', c['v3Factory']), ('v3PositionManager', 'WETH9()', w),
        ('v3TokenDescriptor', 'WETH9()', w), ('v3TokenDescriptor', 'nativeCurrencyLabelBytes()', '0x' + b'OKB'.hex().ljust(64, '0')),
        ('v4Descriptor', 'poolManager()', c['v4PoolManager']), ('v4Descriptor', 'wrappedNative()', w),
        ('v4PositionManager', 'poolManager()', c['v4PoolManager']), ('v4PositionManager', 'permit2()', p),
        ('v4PositionManager', 'WETH9()', w), ('v4PositionManager', 'tokenDescriptor()', c['v4Descriptor']),
        ('v4PositionManager', 'unsubscribeGasLimit()', hex(config['v4UnsubscribeGasLimit'])),
        ('universalRouter', 'poolManager()', c['v4PoolManager']),
        ('universalRouter', 'V3_POSITION_MANAGER()', c['v3PositionManager']),
        ('universalRouter', 'V4_POSITION_MANAGER()', c['v4PositionManager']),
        ('universalRouter', 'SPOKE_POOL()', c['unsupportedProtocol'])]
    for name, signature, expected in checks:
        require(number(chain.call(c[name], signature, block=block)) == int(expected, 16), 'Brand dependency binding mismatch: ' + name + '.' + signature)
    proof = {'dependencyBindings': len(checks), 'collections': {}}
    for version in (3, 4):
        manager = c[f'v{version}PositionManager']
        name = abi_string(chain.call(manager, 'name()', block=block))
        symbol = abi_string(chain.call(manager, 'symbol()', block=block))
        require(name == f'SodaDEX V{version} Positions NFT' and symbol == f'SODA-V{version}-POS', 'NFT collection branding mismatch')
        info = chain.call(manager, 'deploymentInfo()', block=block)
        words = [int(info[2+i:2+i+64], 16) for i in range(0, 4 * 64, 64)]
        require(abi_string(info) == 'SodaDEX' and words[1:] == [1, pool.CHAIN, 1], 'Read-only deployment information mismatch')
        if version == 3:
            types = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
            encoding = pool.abi('bytes32,bytes32,bytes32,uint256,address', cast('keccak', types), cast('keccak', name), cast('keccak', '1'), pool.CHAIN, manager)
        else:
            types = 'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
            encoding = pool.abi('bytes32,bytes32,uint256,address', cast('keccak', types), cast('keccak', name), pool.CHAIN, manager)
        domain = chain.call(manager, 'DOMAIN_SEPARATOR()', block=block)
        require(domain.lower() == cast('keccak', encoding).lower(), 'Branded EIP712 domain mismatch')
        proof['collections'][f'v{version}'] = {'name': name, 'symbol': symbol, 'domainSeparator': domain,
            'deploymentInfo': {'project': 'SodaDEX', 'version': 1, 'chainId': pool.CHAIN, 'testDeployment': True}}
    return proof


def nft_metadata(chain, manager, token, version, block):
    uri = abi_string(chain.call(manager, 'tokenURI(uint256)', [token], block=block))
    prefix = 'data:application/json;base64,'
    require(uri.startswith(prefix), 'NFT metadata is not an on-chain base64 JSON')
    decoded = base64.b64decode(uri[len(prefix):], validate=True)
    metadata = json.loads(decoded)
    image = metadata['image']
    prefix = 'data:image/svg+xml;base64,'
    require(image.startswith(prefix), 'NFT image is not on-chain base64 SVG')
    svg = base64.b64decode(image[len(prefix):], validate=True).decode('utf-8')
    require(metadata['name'].startswith('SodaDEX - ') and f'SodaDEX V{version}' in metadata['description'], 'Position JSON branding mismatch')
    require('SodaDEX' in svg and 'TEST DEPLOYMENT' in svg and f'V{version}' in svg
            and 'Uniswap' not in decoded.decode('utf-8') and 'Uniswap' not in svg, 'Position SVG branding/test marker mismatch')
    require('<svg' in svg and '</svg>' in svg and '<script' not in svg.lower(), 'Invalid NFT SVG')
    return {'tokenURI': uri, 'metadata': metadata, 'svgSha256': sha(svg.encode()), 'svg': svg}


def postcondition(chain, original, config, artifacts, row):
    name, block = row['name'], row['receipt']['blockNumber']
    if name in plan.DEPLOYS:
        runtime = chain.rpc('eth_getCode', [row['intent']['expectedAddress'], block])
        runtime_matches_artifact(runtime, artifacts[name], {'NFTDescriptor': config['contracts']['v3NFTDescriptor']},
                                 library_address=config['contracts'][name] if name == 'v3NFTDescriptor' else None)
        digest = sha(bytes.fromhex(runtime[2:]))
        if row.get('expectedRuntimeSha256'):
            require(digest == row['expectedRuntimeSha256'], 'Runtime differs from full rehearsal hash')
        after = chain.snapshot(config, block)
        require(after['stable'] == row['before']['stable'] and after['wrapped'] == row['before']['wrapped']
                and row['before']['native'] - after['native'] == old.receipt_cost(row['receipt']), 'Deployment unexpectedly moved principal')
        return {'after': after, 'runtimeCodeSha256': digest, 'address': row['intent']['expectedAddress']}
    if name in ('revokeOldV3', 'resetPermit2'):
        after = chain.snapshot(config, block)
        require(after['stable'] == row['before']['stable'] and after['wrapped'] == row['before']['wrapped']
                and row['before']['native'] - after['native'] == old.receipt_cost(row['receipt']), 'Approval reset unexpectedly moved principal')
        spender = original['contracts']['v3PositionManager'] if name == 'revokeOldV3' else config['permit2']
        require(number(chain.call(pool.STABLE, 'allowance(address,address)', [config['owner'], spender], block=block)) == 0, 'Old allowance not revoked')
        return {'after': after, 'allowance': 0}
    proof = base.postcondition(chain, config, row.get('contextAtBuild'), row)
    if name in ('mintV3', 'mintV4'):
        version = 3 if name == 'mintV3' else 4
        proof['nft'] = nft_metadata(chain, config['contracts'][f'v{version}PositionManager'], proof['tokenId'], version, block)
    return proof

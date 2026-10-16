#!/usr/bin/env python3
"""Rehearse deployments on a localhost Anvil fork; never sign or broadcast remotely."""

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
ZERO = '0x' + '00' * 20
ZERO32 = '0x' + '00' * 32
POOL_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'
READ_METHODS = {
    'eth_chainId', 'eth_blockNumber', 'eth_gasPrice', 'eth_getCode',
    'eth_getBalance', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_call',
}


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.PIPE).strip()


def rpc(url, method, params=(), *, local=False):
    if local:
        if urllib.parse.urlparse(url).hostname != '127.0.0.1':
            raise ValueError('Local state changes require a 127.0.0.1 endpoint')
    elif method not in READ_METHODS:
        raise ValueError(f'Remote mutation prohibited: {method}')
    request_id = str(uuid.uuid4())
    request = urllib.request.Request(
        url, data=json.dumps({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': list(params)}).encode(),
        headers={'Content-Type': 'application/json', 'User-Agent': 'SodaDex/1.0'},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get('id') != request_id:
        raise RuntimeError('RPC response ID mismatch')
    if 'error' in result:
        raise RuntimeError(f"{method}: {result['error'].get('message', 'RPC error')}")
    return result['result']


def artifact(path):
    data = json.loads(path.read_text())
    bytecode = data['bytecode']
    code = bytecode['object'] if isinstance(bytecode, dict) else bytecode
    links = bytecode.get('linkReferences', {}) if isinstance(bytecode, dict) else data.get('linkReferences', {})
    return {'path': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'bytecodeSha256': hashlib.sha256(code.removeprefix('0x').encode()).hexdigest(),
            'name': path.stem,
            'abi': data['abi'], 'code': code.removeprefix('0x'), 'links': links}


def abi_type(entry):
    if entry['type'].startswith('tuple'):
        return '(' + ','.join(abi_type(item) for item in entry['components']) + ')' + entry['type'][5:]
    return entry['type']


def initcode(data, args, libraries):
    code = data['code']
    for names in data['links'].values():
        for name, references in names.items():
            address = libraries[name].removeprefix('0x')
            for reference in references:
                if reference['length'] != 20:
                    raise ValueError('Unexpected library reference length')
                offset = reference['start'] * 2
                code = code[:offset] + address + code[offset + 40:]
    if not re.fullmatch('[0-9a-fA-F]+', code):
        raise ValueError('Unlinked or invalid creation bytecode')
    constructor = next((item for item in data['abi'] if item['type'] == 'constructor'), {'inputs': []})
    inputs = constructor['inputs']
    if len(inputs) != len(args):
        raise ValueError('Constructor argument count mismatch')
    encoded = command('cast', 'abi-encode', 'constructor(' + ','.join(abi_type(v) for v in inputs) + ')', *map(str, args)) if inputs else '0x'
    return '0x' + code + encoded.removeprefix('0x')


def deployment_steps(config, sources, deploy, execute):
    """One constructor/dependency plan shared by rehearsal and live validation."""
    router = sources / 'universal-router-2.1.2'
    periphery = router / 'lib/v4-periphery'
    core = periphery / 'lib/v4-core'
    v3 = sources / 'v3-artifacts'
    core3 = v3 / 'v3-core-1.0.1/package/artifacts/contracts'
    periphery3 = v3 / 'v3-periphery-1.4.4/package/artifacts/contracts'
    deployed, libraries = {}, {}

    def add(name, path, ctor=()):
        deployed[name] = deploy(name, path, ctor, libraries)
        return deployed[name]

    wrapped, permit, owner = config['wrappedNative'], config['permit2'], config['owner']
    label = '0x' + b'OKB'.hex().ljust(64, '0')
    add('v3Factory', core3 / 'UniswapV3Factory.sol/UniswapV3Factory.json')
    libraries['NFTDescriptor'] = add('v3NFTDescriptor', periphery3 / 'libraries/NFTDescriptor.sol/NFTDescriptor.json')
    add('v3TokenDescriptor', periphery3 / 'NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json', [wrapped, label])
    add('v3PositionManager', periphery3 / 'NonfungiblePositionManager.sol/NonfungiblePositionManager.json', [deployed['v3Factory'], wrapped, deployed['v3TokenDescriptor']])
    add('v3Quoter', periphery3 / 'lens/QuoterV2.sol/QuoterV2.json', [deployed['v3Factory'], wrapped])
    add('v4PoolManager', core / 'out/PoolManager.sol/PoolManager.json', [owner])
    out4 = periphery / 'foundry-out'
    add('v4Descriptor', out4 / 'PositionDescriptor.sol/PositionDescriptor.json', [deployed['v4PoolManager'], wrapped, label])
    add('v4PositionManager', out4 / 'PositionManager.sol/PositionManager.json', [deployed['v4PoolManager'], permit, config['v4UnsubscribeGasLimit'], deployed['v4Descriptor'], wrapped])
    add('v4Quoter', out4 / 'V4Quoter.sol/V4Quoter.json', [deployed['v4PoolManager']])
    add('v4StateView', out4 / 'StateView.sol/StateView.json', [deployed['v4PoolManager']])
    unsupported = add('unsupportedProtocol', router / 'out/UnsupportedProtocol.sol/UnsupportedProtocol.json')
    params = '(' + ','.join([permit, wrapped, unsupported, deployed['v3Factory'], ZERO32, POOL_HASH, deployed['v4PoolManager'], deployed['v3PositionManager'], deployed['v4PositionManager'], unsupported]) + ')'
    add('universalRouter', router / 'out/UniversalRouter.sol/UniversalRouter.json', [params])
    fee = config['requestedFees']
    execute('enableV3LowFeeTier', command('cast', 'calldata', 'enableFeeAmount(uint24,int24)', str(fee['v3PoolFee']), str(fee['v3TickSpacing'])), deployed['v3Factory'])
    return deployed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=18546)
    parser.add_argument('--sources', type=Path, default=ROOT / '.analysis/upstream')
    parser.add_argument('--output', type=Path, default=ROOT / '.analysis/deployment/xlayer-test-rehearsal.json')
    args = parser.parse_args()
    config = json.loads((ROOT / 'deployments/xlayer-test/plan.json').read_text())
    if config['phase'] != 'test' or config['chainId'] != 196 or config['contracts']:
        raise ValueError('This preparation tool requires an undeployed chain-196 test plan')
    remote = config['rpcUrl']
    if int(rpc(remote, 'eth_chainId'), 16) != 196:
        raise ValueError('Source RPC chain mismatch')
    block = rpc(remote, 'eth_blockNumber')
    gas_price = int(rpc(remote, 'eth_gasPrice'), 16)
    owner = config['owner']
    balance = int(rpc(remote, 'eth_getBalance', [owner, block]), 16)
    nonce = int(rpc(remote, 'eth_getTransactionCount', [owner, block]), 16)
    for name in ('wrappedNative', 'permit2'):
        if rpc(remote, 'eth_getCode', [config[name], block]) == '0x':
            raise ValueError(f'Missing dependency: {name}')
    sources = args.sources.resolve()
    router = sources / 'universal-router-2.1.2'
    periphery = router / 'lib/v4-periphery'
    core = periphery / 'lib/v4-core'
    for directory, key in ((router, 'universalRouter'), (periphery, 'v4Periphery'), (core, 'v4Core')):
        if command('git', 'rev-parse', 'HEAD', cwd=directory) != config['versions'][key]:
            raise ValueError(f'Source revision mismatch: {key}')
        if command('git', 'status', '--porcelain', '--untracked-files=no', cwd=directory):
            raise ValueError(f'Modified source checkout: {key}')

    def load_artifact(path):
        data = artifact(path)
        if data['bytecodeSha256'] != config['artifactBytecodeSha256'][data['name']]:
            raise ValueError(f'Creation bytecode hash mismatch: {data["name"]}')
        return data

    v3 = sources / 'v3-artifacts'
    core3 = v3 / 'v3-core-1.0.1/package/artifacts/contracts'
    periphery3 = v3 / 'v3-periphery-1.4.4/package/artifacts/contracts'
    pool = load_artifact(core3 / 'UniswapV3Pool.sol/UniswapV3Pool.json')
    if command('cast', 'keccak', '0x' + pool['code']) != POOL_HASH:
        raise ValueError('V3 pool init-code hash mismatch')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    local_url = f'http://127.0.0.1:{args.port}'
    # Refuse to reuse a running node: it could contain someone else's work.
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', args.port))
    log = (args.output.parent / 'anvil.log').open('w')
    process = subprocess.Popen([
        'anvil', '--host', '127.0.0.1', '--port', str(args.port), '--accounts', '0',
        '--fork-url', remote, '--fork-block-number', str(int(block, 16)), '--chain-id', '196',
        '--auto-impersonate', '--gas-price', str(gas_price), '--silent',
    ], stdout=log, stderr=log)
    transactions, deployed = [], {}
    try:
        def assert_owned_node():
            if process.poll() is not None:
                raise RuntimeError('The Anvil process started by this tool has exited')
            listeners = command('lsof', '-nP', f'-iTCP@127.0.0.1:{args.port}', '-sTCP:LISTEN', '-t')
            if set(listeners.splitlines()) != {str(process.pid)}:
                raise RuntimeError('The localhost listener does not belong to this Anvil process')

        for _ in range(120):
            try:
                client = rpc(local_url, 'web3_clientVersion', local=True)
                assert_owned_node()
                break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError('Anvil startup failed; inspect the local anvil.log')
                time.sleep(0.25)
        else:
            raise RuntimeError('Anvil startup timed out')
        if 'anvil' not in client.lower() or int(rpc(local_url, 'eth_chainId', local=True), 16) != 196:
            raise ValueError('Local node identity mismatch')
        # This balance is fictitious and is changed only on the new localhost fork.
        assert_owned_node()
        rpc(local_url, 'anvil_setBalance', [owner, hex(10**18)], local=True)

        def execute(name, data, to=None, provenance=None):
            tx = {'from': owner, 'data': data, 'value': '0x0', 'nonce': hex(nonce + len(transactions))}
            if to:
                tx['to'] = to
            estimate = int(rpc(local_url, 'eth_estimateGas', [tx], local=True), 16)
            tx['gas'] = hex(estimate + estimate // 10)
            assert_owned_node()
            tx_hash = rpc(local_url, 'eth_sendTransaction', [tx], local=True)
            receipt = None
            for _ in range(300):
                receipt = rpc(local_url, 'eth_getTransactionReceipt', [tx_hash], local=True)
                if receipt is not None:
                    break
                time.sleep(0.1)
            if not receipt or receipt['status'] != '0x1':
                raise RuntimeError(f'Local deployment failed: {name}')
            address = receipt.get('contractAddress')
            runtime_hash = None
            if address:
                deployed[name] = address
                runtime = rpc(local_url, 'eth_getCode', [address, 'latest'], local=True)
                if runtime == '0x':
                    raise ValueError(f'Empty deployed code: {name}')
                runtime_hash = hashlib.sha256(bytes.fromhex(runtime[2:])).hexdigest()
            transactions.append({'name': name, 'unsigned': {**tx, 'chainId': 196},
                                 'localReceipt': receipt, 'artifact': provenance, 'runtimeCodeSha256': runtime_hash})
            print(f'{name}: local gasUsed={int(receipt["gasUsed"], 16)}', flush=True)
            return address

        def deploy(name, path, ctor, libraries):
            source = load_artifact(path)
            return execute(name, initcode(source, ctor, libraries), provenance={k: source[k] for k in ('path', 'sha256')})

        wrapped, permit = config['wrappedNative'], config['permit2']
        deployed = deployment_steps(config, sources, deploy, execute)

        def check(address, signature, expected):
            result = rpc(local_url, 'eth_call', [{'to': address, 'data': command('cast', 'calldata', signature)}, 'latest'], local=True)
            if int(result, 16) != int(expected, 16):
                raise ValueError(f'Binding mismatch: {signature}')

        check(deployed['v3Factory'], 'owner()', owner)
        check(deployed['v4PoolManager'], 'owner()', owner)
        check(deployed['v4PoolManager'], 'protocolFeeController()', ZERO)
        check(deployed['v3PositionManager'], 'factory()', deployed['v3Factory'])
        check(deployed['v3PositionManager'], 'WETH9()', wrapped)
        check(deployed['v4PositionManager'], 'poolManager()', deployed['v4PoolManager'])
        tier = rpc(local_url, 'eth_call', [{'to': deployed['v3Factory'], 'data': command('cast', 'calldata', 'feeAmountTickSpacing(uint24)', '100')}, 'latest'], local=True)
        if int(tier, 16) != 1:
            raise ValueError('V3 0.01% tier was not enabled')
        used = sum(int(item['localReceipt']['gasUsed'], 16) for item in transactions)
        result = {'status': 'localhost-rehearsal-passed; no-mainnet-deployment', 'chainId': 196,
                  'sourceBlock': int(block, 16), 'sourceGasPriceWei': gas_price,
                  'realOwnerBalanceWei': str(balance), 'ownerNonce': nonce,
                  'totalLocalGasUsed': used,
                  'executionCostAtSnapshotOKB': str(Decimal(used * gas_price) / Decimal(10**18)),
                  'costLimit': 'Local execution estimate; excludes any additional chain fees and future gas-price changes.',
                  'simulatedAddresses': deployed, 'transactions': transactions}
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({k: result[k] for k in ('status', 'sourceBlock', 'realOwnerBalanceWei', 'totalLocalGasUsed', 'executionCostAtSnapshotOKB')}))
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Public reads only. Resolve NFT origin factory separately from FABX registry.

Never accepts keys, signs, broadcasts, or declares a release ready. All RPC state
reads use one pinned block; the output is deployment input for Owner rehearsal.
"""
import argparse
import datetime
import json
import http.client
from pathlib import Path
import subprocess
import urllib.request

SOURCE = 'https://api.fabx.tech/v1/pod/mainnet'
EXPECTED = {
    'token': '0x72F349B1Eee7833B26f8C81a8410775A4e231ed2',
    'mining': '0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265',
    'factory': '0x82935793a854fA2F2e8A9d2B3F17BbfBf81D6C05',
    'nft': '0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6',
}
READS = {'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'}


def request(url, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json', 'User-Agent': 'SodaDEX-readonly-preflight',
    })
    # Read-only API responses can occasionally be truncated by the upstream proxy.
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except (http.client.IncompleteRead, json.JSONDecodeError):
            if attempt == 2:
                raise


def signature(name):
    return subprocess.check_output(['cast', 'sig', name], text=True).strip()


def same(a, b):
    return a.lower() == b.lower()


def inspect(source, rpc):
    if source['chainId'] != 196:
        raise ValueError('FABX config is not chain 196')
    for role in ('token', 'mining', 'factory'):
        if not same(source['contracts'][role], EXPECTED[role]):
            raise ValueError(f'Formal {role} binding changed; review before continuing')
    nft = source['cpus']['FAB-Genisis']['address']
    if not same(nft, EXPECTED['nft']):
        raise ValueError('Formal NFT binding changed; review before continuing')
    if int(rpc('eth_chainId', []), 16) != 196:
        raise ValueError('RPC chain mismatch')
    anchor = rpc('eth_getBlockByNumber', ['latest', False])
    block = anchor['number']
    contracts = source['contracts']

    def call(target, method, *words):
        return rpc('eth_call', [{'to': target, 'data': signature(method) + ''.join(words)}, block])

    def address(result):
        if len(result) != 66 or int(result[2:26], 16) != 0:
            raise ValueError('Malformed address response')
        return '0x' + result[-40:]

    origin = address(call(nft, 'factory()'))
    if not same(address(call(contracts['mining'], 'token()')), contracts['token']):
        raise ValueError('Mining FAB mismatch')
    if int(call(contracts['token'], 'decimals()'), 16) != 8:
        raise ValueError('FAB precision changed')
    nft_word = nft[2:].lower().zfill(64)
    multiplier = int(call(contracts['mining'], 'processorMultiplier(address)', nft_word), 16)
    if multiplier == 0 or multiplier != int(source['cpus']['FAB-Genisis']['multiplier']):
        raise ValueError('Processor multiplier mismatch')
    if int(call(contracts['mining'], 'paused()'), 16) != 0:
        raise ValueError('Mining paused; cannot rehearse admissions')
    for factory in (origin, contracts['factory']):
        if int(call(factory, 'isCPU(address)', nft_word), 16) != 1:
            raise ValueError('NFT not recognized by origin or registry factory')
    codes = {}
    for role, addr in {'fab': contracts['token'], 'mining': contracts['mining'],
                       'nft': nft, 'nftOriginFactory': origin,
                       'miningRegistryFactory': contracts['factory']}.items():
        code = rpc('eth_getCode', [addr, block])
        if len(code) <= 2:
            raise ValueError(f'No code at {role}')
        codes[role] = {'address': addr, 'runtimeHash': subprocess.check_output(
            ['cast', 'keccak', code], text=True).strip()}
    if rpc('eth_getBlockByNumber', [block, False])['hash'] != anchor['hash']:
        raise ValueError('Anchor changed during preflight')
    return {
        'capturedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'chainId': 196, 'block': int(block, 16), 'blockHash': anchor['hash'],
        'fab': contracts['token'], 'mining': contracts['mining'], 'nft': nft,
        'vaultConstructorFactory': origin,
        'miningRegistryFactory': contracts['factory'],
        'processorMultiplier': multiplier, 'code': codes,
        'incomeAccounting': 'FAB balance minus reserved unpaid holder liabilities',
        'directFabTransfers': '85% holders / 10% treasury / 5% LP; approved 2026-10-22 LA',
        'productionWrites': 0, 'formalSodaContracts': None,
        'readyForOwnerBroadcast': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rpc', default='https://rpc.xlayer.tech')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Refusing to overwrite existing evidence')

    def rpc(method, params):
        if method not in READS:
            raise ValueError('Only public read methods allowed')
        result = request(args.rpc, {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params})
        if 'error' in result:
            raise ValueError(f'RPC {method}: {result["error"]}')
        return result['result']

    result = inspect(request(SOURCE), rpc)
    result.update(source=SOURCE, rpc=args.rpc)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()

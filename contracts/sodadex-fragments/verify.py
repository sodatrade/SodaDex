#!/usr/bin/env python3
"""Verify the frozen v5 source/artifact snapshot; optionally reproduce bytecode offline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--solc', type=Path, help='Exact local solc 0.8.26 binary; no download or RPC')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'audit-manifest.json').read_text())
    # Only basic process settings enter compiler/hash subprocesses. No dotenv or wallet keys.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR', 'LANG') if key in os.environ}
    checked = 0
    for group in ('files', 'artifacts', 'vendorSha256'):
        for key, info in manifest[group].items():
            relative = info.get('path', key) if isinstance(info, dict) else key
            expected = info['sha256'] if isinstance(info, dict) else info
            actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
            if actual != expected:
                raise ValueError('SHA256 mismatch: ' + relative)
            checked += 1
    sources = {}
    for name, expected in manifest['deployedSourceKeccak256'].items():
        relative = name.replace('node_modules/@openzeppelin/contracts/', 'vendor/openzeppelin/contracts/')
        content = (ROOT / relative).read_bytes()
        actual = subprocess.check_output(['cast', 'keccak', '0x' + content.hex()], env=env, text=True).strip()
        if actual != expected:
            raise ValueError('Deployed artifact source mismatch: ' + name)
        sources[name] = {'content': content.decode()}
    compiled = []
    if args.solc:
        compiler = args.solc.resolve(strict=True)
        version = subprocess.check_output([str(compiler), '--version'], env=env, text=True)
        if manifest['compiler'] not in version:
            raise ValueError('Exact solc ' + manifest['compiler'] + ' required')
        settings = dict(manifest['settings'])
        settings['outputSelection'] = {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
        data = json.dumps({'language': 'Solidity', 'sources': sources, 'settings': settings})
        result = subprocess.run([str(compiler), '--standard-json'], input=data, capture_output=True, text=True, env=env, check=True)
        output = json.loads(result.stdout)
        errors = [error for error in output.get('errors', []) if error.get('severity') == 'error']
        if errors:
            raise ValueError('\n'.join(error['formattedMessage'] for error in errors))
        for name, info in manifest['artifacts'].items():
            source = next(iter(info['compilationTarget']))
            artifact = json.loads((ROOT / info['path']).read_text())
            actual = output['contracts'][source][name]
            for original, emitted in [('bytecode', 'bytecode'), ('deployedBytecode', 'deployedBytecode')]:
                if actual['evm'][emitted]['object'].removeprefix('0x') != artifact[original]['object'].removeprefix('0x'):
                    raise ValueError(name + ' ' + original + ' differs from deployment artifact')
            # Foundry serializes ABI entries in a different order than solc standard-json.
            canonical_abi = lambda abi: sorted(json.dumps(item, sort_keys=True) for item in abi)
            if canonical_abi(actual['abi']) != canonical_abi(artifact['abi']):
                raise ValueError(name + ' ABI mismatch')
            compiled.append(name)
    print(json.dumps({'sha256FilesChecked': checked, 'deployedSourceHashesChecked': len(sources), 'bytecodeAndAbiReproduced': compiled, 'rpcCalls': 0, 'signedTransactions': 0}, indent=2))


if __name__ == '__main__':
    run()

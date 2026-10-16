#!/usr/bin/env python3
"""Build pinned SodaDEX NFT sources in isolated staging; never accesses a wallet/RPC."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import platform
import posixpath
import re
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'contracts/sodadex-branding'
V3_REV = '697c2474757ea89fec12a4e6db16a574fe259610'
V4_REV = '545a5d2a87228167edde48f3b9eda122d1e3c4d6'
UR_REV = '802fe4c18f47300e0f183e2a42e9146ec2ea9fc3'
V3_ARCHIVE_SHA = '149b0457ef3947f7879c052131297497da61a082fca6c0e05fbbb09e4d136190'
V3_SOLC_SHA = 'a6a8f9f9388c5fcd9222474e00270242c832e936b0f5257c20374d27ee5bd1ab'
PACKAGES = {
    '@openzeppelin/contracts': ('3.4.2-solc-0.7', '38f4dbab672631034076ccdf2f3201fab1726635'),
    '@uniswap/lib': ('4.0.1-alpha', '2881008e55f075344675b3bca93f020b028fbd02'),
    '@uniswap/v3-core': ('1.0.1', 'b6d2bdc6ba3c3fbd610bdc502395d86cd35264a0'),
    'base64-sol': ('1.0.1', '91317aa341f0bc763811783c5729f1c2574600f6'),
}
V3_TARGETS = {'v3NFTDescriptor': ('contracts/libraries/NFTDescriptor.sol', 'NFTDescriptor', 1000),
              'v3TokenDescriptor': ('contracts/NonfungibleTokenPositionDescriptor.sol', 'NonfungibleTokenPositionDescriptor', 1000),
              'v3PositionManager': ('contracts/NonfungiblePositionManager.sol', 'NonfungiblePositionManager', 2000)}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def command(*args, cwd=None):
    result = subprocess.run(list(map(str, args)), cwd=cwd, capture_output=True, text=True)
    require(result.returncode == 0, f'{args[0]} failed: {result.stderr[-2000:]}')
    return result.stdout.strip()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def portable_input(value):
    """Keep complete solc input; Foundry's host-path hints are CLI options."""
    result = {key: value[key] for key in ('language', 'sources', 'settings')}
    require(result['language'] == 'Solidity' and result['sources'], 'Incomplete compiler input')
    require(all(isinstance(source.get('content'), str) for source in result['sources'].values()),
            'Compiler input must include every source file')
    return result


def fetch(url, path, expected, algorithm='sha256'):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'SodaDEX-reproducible-build/1.0'})
        path.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    require(hashlib.new(algorithm, path.read_bytes()).hexdigest() == expected, f'Pinned download hash mismatch: {path.name}')
    return path


def unpack(archive, target):
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as package:
        for member in package.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            require(not member.issym() and not member.islnk() and '..' not in parts, 'Archive contains unsupported link/path')
            output = target.joinpath(*parts)
            require(output.resolve().is_relative_to(target.resolve()), 'Archive escapes staging')
            if member.isdir():
                output.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(package.extractfile(member).read())


def compiler(version, explicit, workspace):
    if explicit:
        result = explicit.resolve()
    else:
        caches = [Path.home() / 'Library/Application Support/svm' / version / ('solc-' + version),
                  Path.home() / '.svm' / version / ('solc-' + version)]
        result = next((path for path in caches if path.is_file()), None)
        if result is None and version == '0.7.6' and platform.system() == 'Darwin':
            name = 'solc-macosx-amd64-v0.7.6+commit.7338295f'
            result = fetch('https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/macosx-amd64/' + name,
                           workspace / 'downloads' / name, V3_SOLC_SHA)
            result.chmod(0o755)
        require(result is not None, f'Pass --solc-v{3 if version == "0.7.6" else 4} with an exact {version} compiler')
    actual = command(result, '--version')
    expected = version + ('+commit.7338295f' if version == '0.7.6' else '+commit.8a97fa7a')
    require(expected in actual, 'Wrong compiler version')
    return result, {'version': expected, 'sha256': sha(result.read_bytes())}


def v3_stage(workspace):
    path = workspace / 'v3'
    archive = fetch('https://codeload.github.com/Uniswap/v3-periphery/tar.gz/' + V3_REV,
                    workspace / 'downloads/v3-periphery-697c247.tar.gz', V3_ARCHIVE_SHA)
    if path.exists():
        shutil.rmtree(path)
    unpack(archive, path)
    for name, (version, integrity) in PACKAGES.items():
        base = name.split('/')[-1]
        url = f'https://registry.npmjs.org/{name}/-/{base}-{version}.tgz'
        packed = fetch(url, workspace / 'downloads' / f'{base}-{version}.tgz', integrity, 'sha1')
        unpack(packed, path / 'node_modules' / name)
    return path


def source_tree(root, entries):
    sources = {}
    def visit(unit):
        if unit in sources:
            return
        path = root / unit
        if not path.exists():
            path = root / 'node_modules' / unit
        require(path.is_file(), 'Missing import: ' + unit)
        text = path.read_text()
        sources[unit] = {'content': text}
        for imported in re.findall(r'import\s+(?:[^;]*?\bfrom\s*)?[\'\"]([^\'\"]+)[\'\"]\s*;', text):
            visit(posixpath.normpath(posixpath.join(posixpath.dirname(unit), imported)) if imported.startswith('.') else imported)
    for entry in entries:
        visit(entry)
    return sources


def standard_compile(solc, root, targets, runs, output):
    settings = {'optimizer': {'enabled': True, 'runs': runs}, 'evmVersion': 'istanbul', 'metadata': {'bytecodeHash': 'none'},
                'outputSelection': {'*': {'*': ['abi', 'metadata', 'evm.bytecode', 'evm.deployedBytecode', 'evm.methodIdentifiers']}}}
    value = {'language': 'Solidity', 'sources': source_tree(root, [row[0] for row in targets.values()]), 'settings': settings}
    write_json(output, value)
    result = subprocess.run([str(solc), '--standard-json'], input=json.dumps(value), capture_output=True, text=True)
    require(result.returncode == 0, 'Solidity compiler process failed')
    compiled = json.loads(result.stdout)
    errors = [e for e in compiled.get('errors', []) if e['severity'] == 'error']
    require(not errors, '\n'.join(e.get('formattedMessage', e['message']) for e in errors))
    artifacts = {}
    for name, (unit, contract, _) in targets.items():
        row = compiled['contracts'][unit][contract]
        artifacts[name] = {'abi': row['abi'], 'bytecode': row['evm']['bytecode'], 'deployedBytecode': row['evm']['deployedBytecode'],
                           'methodIdentifiers': row['evm']['methodIdentifiers'], 'metadata': json.loads(row['metadata']), 'sourceName': unit, 'contractName': contract}
    return artifacts, value


def normalize(artifact):
    result = dict(artifact)
    for key in ('bytecode', 'deployedBytecode'):
        value = result[key]
        if isinstance(value, str):
            value = {'object': value, 'linkReferences': result.get('deployedLinkReferences' if key == 'deployedBytecode' else 'linkReferences', {})}
        else:
            value = dict(value)
        value['object'] = '0x' + value['object'].removeprefix('0x')
        result[key] = value
    return result


def check_abi(original, changed, *, manager=False):
    added = [row for row in changed if row.get('name') == 'deploymentInfo']
    require(len(added) == int(manager), 'Unexpected deploymentInfo ABI count')
    require([row for row in changed if row.get('name') != 'deploymentInfo'] == original, 'Existing ABI changed')
    if manager:
        require(added[0]['stateMutability'] == 'view' and added[0]['inputs'] == []
                and [row['type'] for row in added[0]['outputs']] == ['string', 'uint256', 'uint256', 'bool'], 'Invalid deploymentInfo ABI')


def overlay(stage, version):
    directory = 'contracts' if version == 'v3' else 'src'
    for source in (BRAND / version).rglob('*.sol'):
        destination = stage / directory / source.relative_to(BRAND / version)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    for source in (BRAND / 'common').glob('*.sol'):
        shutil.copyfile(source, stage / directory / 'libraries' / source.name)


def build(args):
    args.output = args.output.resolve()
    workspace = args.output.parent
    workspace.mkdir(parents=True, exist_ok=True)
    canonical_hashes = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in BRAND.rglob('*.sol')}
    if (workspace / 'inputs').exists():
        shutil.rmtree(workspace / 'inputs')
    require('.analysis' in workspace.parts, 'Generated build output must stay in an ignored .analysis directory')
    source_root = args.source_root.resolve()
    upstream = source_root / '.analysis/upstream'
    ur = upstream / 'universal-router-2.1.2'
    periphery = ur / 'lib/v4-periphery'
    immutable = [upstream / 'v3-artifacts/v3-core-1.0.1/package/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json',
                 upstream / 'v3-artifacts/v3-core-1.0.1/package/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json',
                 upstream / 'v3-core/contracts/UniswapV3Factory.sol', upstream / 'v3-core/contracts/UniswapV3Pool.sol',
                 periphery / 'lib/v4-core/src/PoolManager.sol', periphery / 'lib/v4-core/out/PoolManager.sol/PoolManager.json',
                 ur / 'contracts/UniversalRouter.sol', ur / 'out/UniversalRouter.sol/UniversalRouter.json']
    immutable_hashes = {str(p.relative_to(source_root)): sha(p.read_bytes()) for p in immutable}
    for path, revision in ((ur, UR_REV), (periphery, V4_REV)):
        require(command('git', 'rev-parse', 'HEAD', cwd=path) == revision, 'Upstream revision mismatch')
        require(not command('git', 'status', '--porcelain', '--untracked-files=no', cwd=path), 'Upstream sources are modified')
    solc3, compiler3 = compiler('0.7.6', args.solc_v3, workspace)
    solc4, compiler4 = compiler('0.8.26', args.solc_v4, workspace)
    stage3 = v3_stage(workspace)
    old3 = {}
    artifacts, inputs = {}, {}
    npm = upstream / 'v3-artifacts/v3-periphery-1.4.4/package/artifacts'
    for runs in (1000, 2000):
        targets = {k: v for k, v in V3_TARGETS.items() if v[2] == runs}
        originals, baseline_input = standard_compile(solc3, stage3, targets, runs, workspace / f'inputs/v3-baseline-{runs}.json')
        for name, (unit, contract, _) in targets.items():
            official = normalize(json.loads((npm / unit / f'{contract}.json').read_text()))
            compiled = normalize(originals[name])
            for key in ('abi', 'bytecode', 'deployedBytecode'):
                if key == 'abi': require(compiled[key] == official[key], 'V3 baseline ABI does not reproduce official artifact')
                else:
                    require(compiled[key]['object'] == official[key]['object']
                            and compiled[key].get('linkReferences', {}) == official[key].get('linkReferences', {}), 'V3 baseline bytecode does not reproduce official artifact: ' + name)
            old3[name] = official
    overlay(stage3, 'v3')
    (stage3 / 'contracts/SodaEscapeHarness.sol').write_text('''// SPDX-License-Identifier: MIT
pragma solidity =0.7.6; pragma abicoder v2;
import {SodaMetadata} from './libraries/SodaMetadata.sol';
contract SodaEscapeHarness { function encode(bytes calldata raw) external pure returns(string memory,string memory) {
return (SodaMetadata.json(string(raw)),SodaMetadata.xml(string(raw))); } }
''')
    for runs in (1000, 2000):
        targets = {k: v for k, v in V3_TARGETS.items() if v[2] == runs}
        if runs == 1000:
            targets['v3EscapeHarness'] = ('contracts/SodaEscapeHarness.sol', 'SodaEscapeHarness', 1000)
        rows, value = standard_compile(solc3, stage3, targets, runs, workspace / f'inputs/v3-sodadex-{runs}.json')
        for name, row in rows.items():
            row = normalize(row)
            if name in old3:
                check_abi(old3[name]['abi'], row['abi'], manager=name == 'v3PositionManager')
            artifacts[name] = row
            inputs[name] = value
    stage4 = workspace / 'v4'
    if stage4.exists():
        shutil.rmtree(stage4)
    shutil.copytree(periphery, stage4, ignore=shutil.ignore_patterns('.git', 'foundry-out', 'out', 'cache', 'build-info', 'node_modules', '.forge-snapshots'))
    harness = 'pragma solidity ^0.8.26; import {Descriptor} from "./libraries/Descriptor.sol"; contract SodaMetadataHarness { function constructTokenURI(Descriptor.ConstructTokenURIParams calldata p) external pure returns(string memory) { return Descriptor.constructTokenURI(p); } }'
    (stage4 / 'src/SodaMetadataHarness.sol').write_text('// SPDX-License-Identifier: MIT\n' + harness + '\n')
    config = (stage4 / 'foundry.toml').read_text().replace('compilation_restrictions = [', 'compilation_restrictions = [\n  { paths = "src/SodaMetadataHarness.sol", optimizer_runs = 1 },', 1)
    (stage4 / 'foundry.toml').write_text(config)
    command('forge', 'build', 'src/SodaMetadataHarness.sol', '--use', solc4, '--offline', '--force', cwd=stage4)
    baseline4 = workspace / 'baseline-artifacts/v4MetadataHarness.json'
    baseline4.parent.mkdir(exist_ok=True)
    shutil.copyfile(stage4 / 'foundry-out/SodaMetadataHarness.sol/SodaMetadataHarness.json', baseline4)
    overlay(stage4, 'v4')
    harness = harness.replace('contract SodaMetadataHarness {', 'import {SodaMetadata} from "./libraries/SodaMetadata.sol"; contract SodaMetadataHarness { function encode(bytes calldata raw) external pure returns(string memory,string memory) { return (SodaMetadata.json(string(raw)),SodaMetadata.xml(string(raw))); }')
    (stage4 / 'src/SodaMetadataHarness.sol').write_text('// SPDX-License-Identifier: MIT\n' + harness + '\n')
    print('Compiling isolated V4 descriptors and position manager', flush=True)
    command('forge', 'build', 'src/PositionManager.sol', 'src/PositionDescriptor.sol', 'src/SodaMetadataHarness.sol',
            '--use', solc4, '--offline', '--build-info', '--build-info-path', 'build-info', '--force', cwd=stage4)
    v4_targets = {'v4Descriptor': ('PositionDescriptor.sol', 'PositionDescriptor'), 'v4PositionManager': ('PositionManager.sol', 'PositionManager'),
                  'v4MetadataHarness': ('SodaMetadataHarness.sol', 'SodaMetadataHarness')}
    for name, (unit, contract) in v4_targets.items():
        row = normalize(json.loads((stage4 / 'foundry-out' / unit / f'{contract}.json').read_text()))
        if name != 'v4MetadataHarness':
            original = json.loads((periphery / 'foundry-out' / unit / f'{contract}.json').read_text())
            check_abi(original['abi'], row['abi'], manager=name == 'v4PositionManager')
        artifacts[name] = row
    build_inputs = []
    for path in sorted((stage4 / 'build-info').glob('*.json')):
        record = json.loads(path.read_text())
        if 'input' in record:
            value = portable_input(record['input'])
            digest = sha(json.dumps(value, sort_keys=True).encode())[:16]
            output = workspace / 'inputs' / ('v4-' + digest + '.json')
            write_json(output, value)
            build_inputs.append(str(output.relative_to(workspace)))
    require(build_inputs, 'Foundry omitted complete standard JSON inputs')
    artifacts['universalRouter'] = normalize(json.loads((ur / 'out/UniversalRouter.sol/UniversalRouter.json').read_text()))
    manifest = {'project': 'SodaDEX', 'status': 'compiled-not-deployed', 'modificationDate': '2026-10-16',
                'versions': {'v3Periphery': V3_REV, 'v4Periphery': V4_REV, 'universalRouter': UR_REV},
                'compilers': {'v3': compiler3, 'v4': compiler4}, 'v3BaselineExactBytecodeMatches': list(V3_TARGETS), 'artifacts': {},
                'canonicalSources': canonical_hashes, 'testArtifacts': {}, 'baselineArtifacts': {'v4MetadataHarness': str(baseline4.relative_to(workspace))},
                'standardJsonInputs': [str(p.relative_to(workspace)) for p in sorted((workspace / 'inputs').glob('*.json'))]}
    for name, row in artifacts.items():
        path = workspace / 'artifacts' / (name + '.json')
        write_json(path, row)
        creation, runtime = row['bytecode']['object'][2:], row['deployedBytecode']['object'][2:]
        require(len(runtime) // 2 <= 24576, 'EIP-170 runtime limit exceeded: ' + name)
        target = manifest['testArtifacts'] if name.endswith('Harness') else manifest['artifacts']
        target[name] = {'path': str(path.relative_to(workspace)), 'artifactSha256': sha(path.read_bytes()),
            'creationObjectSha256': sha(creation.encode()), 'runtimeObjectSha256': sha(runtime.encode()),
            'creationBytes': len(creation)//2, 'runtimeBytes': len(runtime)//2, 'baselineAbiPreserved': name != 'v4MetadataHarness',
            'settings': row.get('metadata', {}).get('settings', {})}
    require(immutable_hashes == {str(p.relative_to(source_root)): sha(p.read_bytes()) for p in immutable}, 'Existing Factory/Pool/Router sources or artifacts changed during build')
    manifest['unmodified'] = immutable_hashes
    licenses = workspace / 'licenses'
    if licenses.exists():
        shutil.rmtree(licenses)
    licenses.mkdir(exist_ok=True)
    for label, folder in [('v3', stage3), ('v4', stage4), ('universal-router', ur)]:
        for p in folder.rglob('*'):
            if p.is_file() and '.git' not in p.parts and (p.name.upper().startswith('LICENSE') or p.name.upper().startswith('COPYING')):
                destination = licenses / label / p.relative_to(folder)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, destination)
    archive_path = workspace / 'compiler-inputs.tar.gz'
    with archive_path.open('wb') as destination, gzip.GzipFile(fileobj=destination, mode='wb', mtime=0, filename='') as zipped, tarfile.open(fileobj=zipped, mode='w') as tar:
        for folder in (workspace / 'inputs', licenses):
            for p in sorted(folder.rglob('*')):
                if p.is_file():
                    data = p.read_bytes()
                    entry = tarfile.TarInfo(str(p.relative_to(workspace)))
                    entry.size, entry.mode, entry.mtime = len(data), 0o644, 0
                    tar.addfile(entry, io.BytesIO(data))
    manifest['sourceBundle'] = {'path': archive_path.name, 'sha256': sha(archive_path.read_bytes())}
    require(canonical_hashes == {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in BRAND.rglob('*.sol')}, 'Canonical sources changed during compilation; rerun the build')
    write_json(args.output, manifest)
    print(json.dumps({'status': manifest['status'], 'manifest': str(args.output), 'sizes': {k: v['runtimeBytes'] for k, v in manifest['artifacts'].items()}}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, default=ROOT / '.analysis/branding/build.json')
    parser.add_argument('--solc-v3', type=Path)
    parser.add_argument('--solc-v4', type=Path)
    try:
        build(parser.parse_args())
    except Exception as error:
        print(f'Branding build stopped: {type(error).__name__}: {error}', flush=True)
        raise SystemExit(1) from None

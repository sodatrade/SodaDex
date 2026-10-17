"""Branding checks; --manifest additionally deploys only to a new local Anvil.

No remote RPC, wallet, private key, signing or broadcast is used by these tests.
"""
import argparse
import base64
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
import uuid
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location('branding_builder', Path(__file__).with_name('build-branding.py'))
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)
MANIFEST = None
SOURCE_ROOT = Path(__file__).resolve().parents[2]
OWNER = '0x' + '12' * 20
ONE, TWO, THREE, FOUR = ['0x' + f'{n:040x}' for n in (1, 2, 3, 4)]


def cast(*args):
    return builder.command('cast', *args)


def word(value):
    return (value % (1 << 256)).to_bytes(32, 'big')


def tuple_call(signature, values):
    """The fixture tuple contains dynamic string/bytes and static scalar fields."""
    heads, tails = [], b''
    for value in values:
        if isinstance(value, (str, bytes)) and not (isinstance(value, str) and value.startswith('0x')):
            raw = value.encode() if isinstance(value, str) else value
            heads.append(word(32 * len(values) + len(tails)))
            tails += word(len(raw)) + raw + b'\0' * (-len(raw) % 32)
        else:
            heads.append(word(int(value, 16) if isinstance(value, str) else int(value)))
    return cast('sig', signature) + (word(32) + b''.join(heads) + tails).hex()


def abi_string(data, offset_index=0):
    raw = bytes.fromhex(data[2:])
    offset = int.from_bytes(raw[offset_index*32:offset_index*32+32], 'big')
    size = int.from_bytes(raw[offset:offset+32], 'big')
    return raw[offset+32:offset+32+size].decode()


class BuildInvariants(unittest.TestCase):
    def test_complete_compiler_input_does_not_depend_on_checkout_location(self):
        source = {'language': 'Solidity', 'sources': {'Position.sol': {'content': 'pragma solidity ^0.8.26; contract Position {}'}},
                  'settings': {'optimizer': {'enabled': True, 'runs': 500}}}
        one = builder.portable_input({**source, 'basePath': '/checkout/one', 'includePaths': ['/checkout/one'], 'allowPaths': ['/checkout/one/lib']})
        two = builder.portable_input({**source, 'basePath': '/another/checkout', 'includePaths': ['/another/checkout'], 'allowPaths': ['/another/checkout/lib']})
        self.assertEqual(one, two)
        self.assertEqual(one, source)
        with self.assertRaisesRegex(ValueError, 'every source file'):
            builder.portable_input({**source, 'sources': {'Position.sol': {'urls': ['file://Position.sol']}}})

    def test_original_abi_is_a_strict_subset_with_one_readonly_method(self):
        original = [{'type': 'function', 'name': 'mint', 'inputs': [], 'outputs': [], 'stateMutability': 'payable'}]
        info = {'type': 'function', 'name': 'deploymentInfo', 'inputs': [], 'outputs': [{'type': t} for t in ('string', 'uint256', 'uint256', 'bool')], 'stateMutability': 'view'}
        builder.check_abi(original, original + [info], manager=True)
        with self.assertRaises(ValueError):
            builder.check_abi(original, [info], manager=True)
        with self.assertRaises(ValueError):
            builder.check_abi(original, original + [{**info, 'stateMutability': 'nonpayable'}], manager=True)

    def test_canonical_patches_keep_original_license_and_named_attribution(self):
        root = Path(__file__).resolve().parents[2] / 'contracts/sodadex-branding'
        for version in ('v3', 'v4'):
            for source in (root / version).rglob('*.sol'):
                text = source.read_text()
                self.assertTrue(text.startswith('// SPDX-License-Identifier:'))
                self.assertIn('2026-10-16', text)
        self.assertIn('Forged in SVG for Uniswap', (root / 'v3/libraries/NFTSVG.sol').read_text())


@unittest.skipUnless(MANIFEST, 'Pass --manifest for compiled local-chain evidence')
class CompiledBranding(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix='sodadex-branding-')
        cls.manifest = json.loads(MANIFEST.read_text())
        cls.artifacts = {}
        for name, row in {**cls.manifest['artifacts'], **cls.manifest['testArtifacts']}.items():
            path = MANIFEST.parent / row['path']
            if builder.sha(path.read_bytes()) != row['artifactSha256']:
                raise ValueError('Artifact hash changed')
            cls.artifacts[name] = json.loads(path.read_text())
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            cls.port = reservation.getsockname()[1]
        cls.log = open(Path(cls.folder.name) / 'anvil.log', 'w')
        cls.process = subprocess.Popen(['anvil', '--host', '127.0.0.1', '--port', str(cls.port), '--accounts', '0',
            '--chain-id', '196', '--hardfork', 'cancun', '--auto-impersonate', '--silent'], stdout=cls.log, stderr=cls.log)
        try:
            for _ in range(100):
                try:
                    if cls.rpc('eth_chainId') == '0xc4': break
                except (OSError, ValueError, subprocess.CalledProcessError): time.sleep(0.05)
            else: raise RuntimeError('Local Anvil startup failed')
            cls.rpc('anvil_setBalance', [OWNER, hex(10**21)])
            cls.addresses, cls.deployments = {}, {}
            cls.addresses['v3NFTDescriptor'] = cls.deploy('v3NFTDescriptor')
            cls.addresses['v3TokenDescriptor'] = cls.deploy('v3TokenDescriptor', cast('abi-encode', 'f(address,bytes32)', TWO, '0x' + b'OKB'.hex().ljust(64, '0')))
            cls.addresses['v3PositionManager'] = cls.deploy('v3PositionManager', cast('abi-encode', 'f(address,address,address)', ONE, TWO, cls.addresses['v3TokenDescriptor']))
            cls.addresses['v4Descriptor'] = cls.deploy('v4Descriptor', cast('abi-encode', 'f(address,address,bytes32)', THREE, TWO, '0x' + b'OKB'.hex().ljust(64, '0')))
            cls.addresses['v4PositionManager'] = cls.deploy('v4PositionManager', cast('abi-encode', 'f(address,address,uint256,address,address)', THREE, FOUR, 300000, cls.addresses['v4Descriptor'], TWO))
            params = '(' + ','.join([FOUR, TWO, ONE, ONE, '0x' + '00' * 32,
                '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54', THREE,
                cls.addresses['v3PositionManager'], cls.addresses['v4PositionManager'], ONE]) + ')'
            cls.addresses['universalRouter'] = cls.deploy('universalRouter', cast('abi-encode', 'f((address,address,address,address,bytes32,bytes32,address,address,address,address))', params))
            cls.addresses['v3EscapeHarness'] = cls.deploy('v3EscapeHarness')
            cls.addresses['v4MetadataHarness'] = cls.deploy('v4MetadataHarness')
            original3 = SOURCE_ROOT / '.analysis/upstream/v3-artifacts/v3-periphery-1.4.4/package/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json'
            cls.artifacts['baselineV3'] = builder.normalize(json.loads(original3.read_text()))
            cls.artifacts['baselineV4'] = builder.normalize(json.loads((MANIFEST.parent / cls.manifest['baselineArtifacts']['v4MetadataHarness']).read_text()))
            cls.addresses['baselineV3'] = cls.deploy('baselineV3')
            cls.addresses['baselineV4'] = cls.deploy('baselineV4')
        except Exception:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'process'):
            cls.process.terminate()
            cls.process.wait(timeout=10)
        if hasattr(cls, 'log'): cls.log.close()
        if hasattr(cls, 'folder'): cls.folder.cleanup()

    @classmethod
    def rpc(cls, method, params=()):
        if cls.process.poll() is not None: raise ValueError('Owned Anvil exited')
        ids = subprocess.check_output(['lsof', '-nP', f'-iTCP@127.0.0.1:{cls.port}', '-sTCP:LISTEN', '-t'], text=True).splitlines()
        if set(ids) != {str(cls.process.pid)}: raise ValueError('Local node ownership mismatch')
        identifier = str(uuid.uuid4())
        req = urllib.request.Request(f'http://127.0.0.1:{cls.port}', json.dumps({'jsonrpc': '2.0', 'id': identifier, 'method': method, 'params': list(params)}).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as response: result = json.load(response)
        if result.get('id') != identifier or 'error' in result: raise ValueError(f'Local {method} failed: {result.get("error", {})}')
        return result['result']

    @classmethod
    def deploy(cls, name, args='0x'):
        artifact = cls.artifacts[name]
        code = artifact['bytecode']['object'][2:]
        for libraries in artifact['bytecode'].get('linkReferences', {}).values():
            for library, refs in libraries.items():
                if library != 'NFTDescriptor': raise ValueError('Unexpected library link')
                for ref in refs:
                    if ref['length'] != 20: raise ValueError('Invalid link width')
                    start = ref['start'] * 2
                    code = code[:start] + cls.addresses['v3NFTDescriptor'][2:] + code[start+40:]
        data = '0x' + code + args[2:]
        tx = {'from': OWNER, 'data': data, 'gas': hex(15000000)}
        tx_hash = cls.rpc('eth_sendTransaction', [tx])
        receipt = None
        for _ in range(300):
            receipt = cls.rpc('eth_getTransactionReceipt', [tx_hash])
            if receipt: break
            time.sleep(0.01)
        if receipt is None or receipt['status'] != '0x1': raise ValueError('Local deployment failed: ' + name)
        cls.deployments[name] = {'gasUsed': int(receipt['gasUsed'], 16), 'address': receipt['contractAddress']}
        runtime = cls.rpc('eth_getCode', [receipt['contractAddress'], 'latest'])
        if len(runtime[2:])//2 > 24576: raise ValueError('EIP-170 limit exceeded')
        return receipt['contractAddress']

    def call(self, name, signature, *args):
        return self.rpc('eth_call', [{'to': self.addresses[name], 'data': cast('calldata', signature, *args)}, 'latest'])

    def metadata(self, version, quote='USD₮0', base=None, *, original=False):
        if base is None: base = 'WOKB' if version == 3 else 'OKB'
        types = 'uint256,address,address,string,string,uint8,uint8,bool,int24,int24,int24,int24,uint24,address' + (',address' if version == 4 else '')
        values = [1, ONE, TWO, quote, base, 6, 18, False, -887272, 887272, 0, 1, 100 if version == 3 else 0, THREE] + ([ONE] if version == 4 else [])
        data = tuple_call('constructTokenURI((' + types + '))', values)
        if version == 3:
            # Solidity libraries hash their struct's qualified name rather than
            # the contract ABI tuple spelling. The payload encoding is unchanged.
            selector = self.artifacts['v3NFTDescriptor']['methodIdentifiers']['constructTokenURI(NFTDescriptor.ConstructTokenURIParams)']
            data = '0x' + selector + data[10:]
        name = ('baselineV3' if version == 3 else 'baselineV4') if original else ('v3NFTDescriptor' if version == 3 else 'v4MetadataHarness')
        tx = {'to': self.addresses[name], 'data': data}
        uri = abi_string(self.rpc('eth_call', [tx, 'latest']))
        parsed = json.loads(base64.b64decode(uri.removeprefix('data:application/json;base64,')))
        svg = base64.b64decode(parsed['image'].removeprefix('data:image/svg+xml;base64,')).decode()
        return parsed, svg, tx

    def test_collection_brand_and_dynamic_deployment_info_and_domains(self):
        for chain in (196, 197):
            self.rpc('anvil_setChainId', [chain])
            for version in (3, 4):
                name = f'v{version}PositionManager'
                collection = f'SodaDEX V{version} Positions NFT'
                self.assertEqual(abi_string(self.call(name, 'name()')), collection)
                self.assertEqual(abi_string(self.call(name, 'symbol()')), f'SODA-V{version}-POS')
                info = self.call(name, 'deploymentInfo()')
                self.assertEqual(abi_string(info), 'SodaDEX')
                raw = bytes.fromhex(info[2:])
                self.assertEqual([int.from_bytes(raw[i:i+32], 'big') for i in (32, 64, 96)], [1, chain, 1])
                type_string = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)' if version == 3 else 'EIP712Domain(string name,uint256 chainId,address verifyingContract)'
                types = 'bytes32,bytes32,' + ('bytes32,' if version == 3 else '') + 'uint256,address'
                args = [cast('keccak', type_string), cast('keccak', collection)] + ([cast('keccak', '1')] if version == 3 else []) + [str(chain), self.addresses[name]]
                expected = cast('keccak', cast('abi-encode', 'f(' + types + ')', *args))
                self.assertEqual(self.call(name, 'DOMAIN_SEPARATOR()'), expected)
        self.rpc('anvil_setChainId', [196])

    def test_decoded_metadata_svg_uses_actual_position_values_and_brand(self):
        self.evidence = []
        for version in (3, 4):
            metadata, svg, tx = self.metadata(version)
            root = ET.fromstring(svg)
            text = ' '.join(root.itertext())
            self.assertTrue(metadata['name'].startswith('SodaDEX - '))
            self.assertIn(f'SodaDEX V{version}', metadata['description'])
            for expected in ('SodaDEX', 'TEST DEPLOYMENT', f'V{version}', 'USD₮0', 'WOKB' if version == 3 else 'OKB', '#1', 'MIN', 'MAX', '0.01%' if version == 3 else '0%'):
                self.assertIn(expected, text)
            self.assertNotIn('Uniswap', text)
            folder = MANIFEST.parent / 'metadata-evidence'
            folder.mkdir(exist_ok=True)
            builder.write_json(folder / f'v{version}.json', metadata)
            (folder / f'v{version}.svg').write_text(svg)

    def test_untrusted_symbols_remain_text_in_valid_json_and_xml(self):
        fixtures = ['"><script>alert(1)</script>&\'\\\n\x01', '中文😀\ufffe\uffff', '\t\r\n"\\&<>']
        for version in (3, 4):
            for symbol in fixtures:
                with self.subTest(version=version, symbol=repr(symbol)):
                    metadata, svg, _ = self.metadata(version, quote=symbol)
                    root = ET.fromstring(svg)
                    self.assertFalse(any(element.tag.endswith('script') for element in root.iter()))
                    self.assertIn('SodaDEX - ', metadata['name'])
                    if '😀' in symbol: self.assertIn('😀', ''.join(root.itertext()))

    def test_escaping_handles_malformed_utf8_and_xml_forbidden_codepoints(self):
        fixtures = [b'a\x00\x01"\\&<>\'b', b'\xed\xa0\x80\xff', 'USD₮0😀\ufffe\uffff'.encode()]
        for harness in ('v3EscapeHarness', 'v4MetadataHarness'):
            for raw in fixtures:
                result = self.call(harness, 'encode(bytes)', '0x' + raw.hex())
                escaped_json, escaped_xml = abi_string(result, 0), abi_string(result, 1)
                json.loads('"' + escaped_json + '"')
                ET.fromstring('<text>' + escaped_xml + '</text>')

    def test_artifact_size_selectors_and_measured_metadata_gas(self):
        evidence = {'deployments': self.deployments, 'metadata': {}}
        for version in (3, 4):
            manager = self.artifacts[f'v{version}PositionManager']
            selectors = manager['methodIdentifiers']
            self.assertEqual(selectors['deploymentInfo()'], cast('sig', 'deploymentInfo()')[2:])
            self.assertEqual(len(selectors), len(set(selectors.values())))
            self.assertLessEqual(self.manifest['artifacts'][f'v{version}PositionManager']['runtimeBytes'], 24576)
            old_metadata, old_svg, old_tx = self.metadata(version, original=True)
            new_metadata, new_svg, new_tx = self.metadata(version)
            old_gas = int(self.rpc('eth_estimateGas', [old_tx]), 16)
            new_gas = int(self.rpc('eth_estimateGas', [new_tx]), 16)
            evidence['metadata'][f'v{version}'] = {'baselineGasEstimate': old_gas, 'sodadexGasEstimate': new_gas,
                'baselineSvgBytes': len(old_svg.encode()), 'sodadexSvgBytes': len(new_svg.encode())}
            self.assertLess(new_gas, old_gas)
        builder.write_json(MANIFEST.parent / 'local-test-evidence.json', evidence)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--source-root', type=Path, default=SOURCE_ROOT)
    args, remaining = parser.parse_known_args()
    MANIFEST, SOURCE_ROOT = args.manifest, args.source_root
    # unittest evaluates skip decorators at import time, before CLI parsing.
    CompiledBranding.__unittest_skip__ = MANIFEST is None
    unittest.main(argv=['test_branding.py', *remaining])

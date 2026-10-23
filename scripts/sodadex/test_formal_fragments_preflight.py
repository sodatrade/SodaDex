import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'formal_preflight', Path(__file__).with_name('formal-fragments-preflight.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ORIGIN = '0x' + '11' * 20
NFT = MODULE.EXPECTED['nft']


def word(value):
    return '0x' + (value[2:] if isinstance(value, str) else hex(value)[2:]).zfill(64)


class ReadFixture:
    def __init__(self):
        self.source = {
            'chainId': 196, 'contracts': dict(MODULE.EXPECTED),
            'cpus': {'FAB-Genisis': {'address': NFT, 'multiplier': 6}},
        }
        self.chain = 196
        self.calls = []
        self.overrides = {}

    def rpc(self, method, params):
        self.calls.append((method, params))
        if method == 'eth_chainId':
            return hex(self.chain)
        if method == 'eth_getBlockByNumber':
            return {'number': '0x1234', 'hash': '0x' + 'aa' * 32}
        if method == 'eth_getCode':
            return '0x6000'
        if method != 'eth_call':
            raise AssertionError('Forbidden write method')
        target, data = params[0]['to'], params[0]['data']
        # Tests use the textual signature as a readable selector surrogate.
        result = {
            'factory()': word(ORIGIN), 'token()': word(MODULE.EXPECTED['token']),
            'decimals()': word(8), 'processorMultiplier(address)': word(6),
            'paused()': word(0), 'isCPU(address)': word(1),
        }
        for name in result:
            if data.startswith(name):
                return self.overrides.get((target, name), result[name])
        raise AssertionError(data)


class FormalPreflightTest(unittest.TestCase):
    def inspect(self, fixture):
        with patch.object(MODULE, 'signature', side_effect=lambda name: name):
            return MODULE.inspect(fixture.source, fixture.rpc)

    def test_origin_and_registry_are_distinct_and_reads_are_pinned(self):
        fixture = ReadFixture()
        result = self.inspect(fixture)
        self.assertEqual(result['vaultConstructorFactory'], ORIGIN)
        self.assertEqual(result['miningRegistryFactory'], MODULE.EXPECTED['factory'])
        self.assertFalse(result['readyForOwnerBroadcast'])
        self.assertIsNone(result['formalSodaContracts'])
        for method, params in fixture.calls:
            if method in ('eth_call', 'eth_getCode'):
                self.assertEqual(params[-1], '0x1234')

    def test_api_address_change_fails_before_chain_reads(self):
        fixture = ReadFixture()
        fixture.source['contracts']['mining'] = ORIGIN
        with self.assertRaisesRegex(ValueError, 'binding changed'):
            self.inspect(fixture)
        self.assertEqual(fixture.calls, [])

    def test_wrong_chain_cannot_produce_deployment_parameters(self):
        fixture = ReadFixture()
        fixture.chain = 1
        with self.assertRaisesRegex(ValueError, 'chain mismatch'):
            self.inspect(fixture)

    def test_mining_must_pay_the_expected_fab(self):
        fixture = ReadFixture()
        fixture.overrides[(MODULE.EXPECTED['mining'], 'token()')] = word(ORIGIN)
        with self.assertRaisesRegex(ValueError, 'FAB mismatch'):
            self.inspect(fixture)

    def test_origin_and_registry_must_both_recognize_nft(self):
        for factory in (ORIGIN, MODULE.EXPECTED['factory']):
            with self.subTest(factory=factory):
                fixture = ReadFixture()
                fixture.overrides[(factory, 'isCPU(address)')] = word(0)
                with self.assertRaisesRegex(ValueError, 'not recognized'):
                    self.inspect(fixture)

    def test_paused_mining_blocks_rehearsal(self):
        fixture = ReadFixture()
        fixture.overrides[(MODULE.EXPECTED['mining'], 'paused()')] = word(1)
        with self.assertRaisesRegex(ValueError, 'Mining paused'):
            self.inspect(fixture)


if __name__ == '__main__':
    unittest.main()

"""Offline pool-phase invariants. No wallet access, network call, or signing."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import pool_plan as p
import pool_chain as chain

SPEC = importlib.util.spec_from_file_location('pool_phase', Path(__file__).with_name('pool-phase.py'))
phase = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(phase)
CONFIG = json.loads((Path(__file__).resolve().parents[2] / 'deployments/xlayer-test/plan.json').read_text())
OWNER = CONFIG['owner']


def seed_fixture():
    words = [123, int('ee' * 20, 16), int(p.STABLE, 16), p.BUY, 11737, 1800000600, 224]
    return {'chainId': 196, 'owner': OWNER, 'quoteBlock': 100, 'createdAt': 1800000000,
            'fromAmount': str(p.BUY), 'toAmount': '11795', 'minReceiveAmount': '11737',
            'routerCodeSha256': '4e884ab2966a335f3462791c91acc1819a2209ec2ace1716e3498463ccb0a1ce',
            'tx': {'to': '0x7c5bee2a8091c3ef39072f64f18fac913060aeaf', 'value': str(p.BUY),
                   'data': '0xf2c42696' + ''.join(f'{word:064x}' for word in words)}}


class PoolMathTests(unittest.TestCase):
    def test_micro_six_decimal_minimum_never_exceeds_half_percent_slippage(self):
        for quote in (1, 2, 99, 100, 117, 11795, 10**18):
            minimum = p.min_output(quote)
            self.assertLessEqual((quote - minimum) * 10000, quote * 50)
            self.assertGreater(minimum, 0)
        with self.assertRaises(ValueError):
            p.min_output(0)

    def test_full_range_preserves_both_caps_after_rounding(self):
        for stable in (1000, 5768, 20000):
            sqrt = p.sqrt_price(p.BUY, 11795)
            lp = p.full_range(sqrt, stable, p.LP_NATIVE)
            self.assertLessEqual(lp['amount0'], stable)
            self.assertLessEqual(lp['amount1'], p.LP_NATIVE)
            self.assertGreater(lp['amount0'], 0)
            self.assertGreater(lp['amount1'], 0)
        with self.assertRaises(ValueError):
            p.full_range(p.MIN_SQRT, 1, 1)

    def test_two_pool_context_uses_seed_minimum_and_reserves_reverse_inputs(self):
        seed = seed_fixture()
        ctx = p.context(seed)
        self.assertLessEqual(2 * ctx['stableCap'] + 2 * p.REVERSE, int(seed['minReceiveAmount']))
        self.assertEqual(ctx['lp3']['amount0'], ctx['lp4']['amount1'])
        self.assertEqual(ctx['lp3']['amount1'], ctx['lp4']['amount0'])
        self.assertEqual(p.BUY + 2 * p.LP_NATIVE + 2 * p.FORWARD, p.PRINCIPAL_CAP)

    def test_seed_checks_authoritative_router_calldata_and_freshness(self):
        seed = seed_fixture()
        p.validate_seed(seed, CONFIG, 1800000010, 101)
        for mutate in (
            lambda s: s.update(chainId=1), lambda s: s.update(minReceiveAmount='1'),
            lambda s: s['tx'].update(value='1'), lambda s: s['tx'].update(to=OWNER),
            lambda s: s['tx'].update(data='0xdeadbeef' + s['tx']['data'][10:]),
            lambda s: s.update(createdAt=1799999000), lambda s: s.update(routerCodeSha256='0' * 64),
        ):
            altered = copy.deepcopy(seed)
            mutate(altered)
            with self.assertRaises(ValueError):
                p.validate_seed(altered, CONFIG, 1800000010, 101)


class ExecutionTests(unittest.TestCase):
    def tx(self, value=1, gas=100, price=21):
        return {'chainId': 196, 'from': OWNER, 'to': p.STABLE, 'nonce': '0x0', 'gas': hex(gas),
                'gasPrice': hex(price), 'value': hex(value), 'data': '0x1234'}

    def row(self):
        return {'unsigned': self.tx(), 'raw': 'private-signed-fixture', 'hash': '0x1234'}

    def test_signed_native_value_and_every_intent_field_are_bound(self):
        actual = {'chainId': 196, 'signer': OWNER, 'to': p.STABLE, 'nonce': 0, 'gas': 100,
                  'gasPrice': 21, 'value': 1, 'type': 0, 'input': '0x1234'}
        chain.validate_signed(self.row(), lambda _: actual, lambda _: '0x1234')
        for key, bad in [('chainId', 1), ('signer', p.STABLE), ('to', OWNER), ('nonce', 1),
                         ('gas', 99), ('gasPrice', 22), ('value', 0), ('type', 2), ('input', '0xabcd')]:
            with self.subTest(field=key), self.assertRaises(ValueError):
                chain.validate_signed(self.row(), lambda _: {**actual, key: bad}, lambda _: '0x1234')
        with self.assertRaises(ValueError):
            chain.validate_signed(self.row(), lambda _: actual, lambda _: '0x5678')

    def test_gross_principal_does_not_credit_lp_refunds_or_reverse_proceeds(self):
        rows = [{'unsigned': self.tx(value=p.BUY), 'receipt': {'gasUsed': '0x1', 'effectiveGasPrice': '0x1'}}]
        remaining = [self.tx(value=p.LP_NATIVE), self.tx(value=p.LP_NATIVE),
                     self.tx(value=p.FORWARD), self.tx(value=p.FORWARD)]
        self.assertEqual(chain.budgets(rows, remaining)['grossPrincipalWei'], p.PRINCIPAL_CAP)
        with self.assertRaisesRegex(ValueError, 'principal'):
            chain.budgets(rows, remaining + [self.tx(value=1)])

    def test_gas_reserves_all_unsigned_and_signed_pending_caps(self):
        row = self.row()
        result = chain.budgets([row], [self.tx(value=0)])
        self.assertEqual(result['remainingGasCapWei'], 4200)
        with patch.object(p, 'GAS_CAP', 4199), self.assertRaisesRegex(ValueError, 'gas budget'):
            chain.budgets([row], [self.tx(value=0)])
        with self.assertRaisesRegex(ValueError, 'balance'):
            chain.budgets([row], [], balance=2100)

    def test_live_raw_estimate_can_use_margin_inside_fixed_rehearsed_cap(self):
        phase.gas_cap_gate(105, 110)
        phase.gas_cap_gate(110, 110)
        with self.assertRaisesRegex(ValueError, 'raw gas estimate'):
            phase.gas_cap_gate(111, 110)
        client = Mock()
        client.rpc.side_effect = ['0x', '0x64']
        self.assertEqual(phase.simulate(client, {'to': p.STABLE, 'data': '0x', 'value': 0}, OWNER), 110)

    def test_default_chain_never_broadcasts_or_signs(self):
        client = chain.Chain()
        for method in ('eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'anvil_setBalance'):
            with self.subTest(method=method), self.assertRaises(ValueError):
                client.rpc(method)

    def test_private_journal_is_durable_before_broadcast_and_mode_is_0600(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'journal.json'
            row = self.row()
            chain.save(path, {'rows': [row]})
            self.assertEqual(json.loads(path.read_text())['rows'][0]['raw'], row['raw'])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_semantic_row_tampering_is_rejected_independent_of_signed_envelope(self):
        seed = seed_fixture()
        ctx = p.context(seed)
        intent = p.build('seed', CONFIG, seed, ctx, 1800000600)
        row = {'name': 'seed', 'intent': intent, 'unsigned': chain.make_unsigned(intent, OWNER, 13, 200000, 21)}
        phase.validate_row(row, CONFIG, seed, ctx, 13)
        for mutate in (lambda r: r['intent'].update(value=1), lambda r: r['unsigned'].update(value='0x1'),
                       lambda r: r['unsigned'].update(to=OWNER), lambda r: r['unsigned'].update(nonce='0xe')):
            altered = copy.deepcopy(row)
            mutate(altered)
            with self.assertRaises(ValueError):
                phase.validate_row(altered, CONFIG, seed, ctx, 13)


class RecoveryTests(unittest.TestCase):
    def journal(self):
        return {'ownerNonce': 13, 'rows': [{'name': 'seed', 'raw': 'durable-private-fixture', 'hash': '0x1234',
            'unsigned': {'nonce': '0xd'}, 'intent': {'deadline': 1800000600}, 'before': {'native': 100}}]}

    def run_reconcile(self, journal, client, found, gate=None):
        with tempfile.TemporaryDirectory() as temporary, patch.object(phase, 'validate_row'), \
             patch.object(phase, 'receipt', return_value=found), patch.object(phase, 'postcondition', return_value={}), \
             patch.object(phase, 'wait_receipt', return_value={'blockHash': '0xabc'}) as wait, \
             patch.object(phase, 'unsent_gate', side_effect=gate) as unsent:
            phase.reconcile(client, Path(temporary) / 'journal.json', journal, CONFIG, {}, seed_fixture(), {}, {})
            return wait, unsent

    def test_mined_receipt_is_recovered_without_resigning_or_rebroadcast(self):
        client = Mock()
        journal = self.journal()
        wait, unsent = self.run_reconcile(journal, client, {'blockHash': '0xabc'})
        self.assertEqual(journal['rows'][0]['receipt']['blockHash'], '0xabc')
        client.rpc.assert_not_called()
        wait.assert_not_called()
        unsent.assert_not_called()

    def test_known_pending_is_only_waited_even_when_its_deadline_expired(self):
        client = Mock()
        client.rpc.return_value = {'hash': '0x1234', 'blockNumber': None}
        journal = self.journal()
        journal['rows'][0]['intent']['deadline'] = 1
        wait, unsent = self.run_reconcile(journal, client, None)
        wait.assert_called_once()
        unsent.assert_not_called()
        self.assertEqual([call.args[0] for call in client.rpc.call_args_list], ['eth_getTransactionByHash'])

    def test_unknown_expired_hash_is_not_broadcast(self):
        client = Mock()
        client.rpc.return_value = None
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.run_reconcile(self.journal(), client, None, ValueError('expired'))
        self.assertNotIn('eth_sendRawTransaction', [call.args[0] for call in client.rpc.call_args_list])

    def test_frozen_expired_intent_fails_real_unsent_gate_before_rpc_write(self):
        client = Mock()
        row = self.journal()['rows'][0]
        with patch.object(phase, 'runtime_gate'), patch.object(phase, 'latest', return_value=(100, 1800000601)), \
             self.assertRaisesRegex(ValueError, 'expired'):
            phase.unsent_gate(client, row, CONFIG, {}, seed_fixture(), {}, self.journal(), 0)
        client.rpc.assert_not_called()

    def test_unknown_nonce_occupancy_fails_unsent_gate(self):
        client = Mock()
        journal = self.journal()
        row = journal['rows'][0]
        client.snapshot.return_value = row['before']
        client.rpc.side_effect = ['0xd', '0xe']
        with patch.object(phase, 'runtime_gate'), patch.object(phase, 'latest', return_value=(101, 1800000010)), \
             self.assertRaisesRegex(ValueError, 'nonce'):
            phase.unsent_gate(client, row, CONFIG, {}, seed_fixture(), {}, journal, 0)
        self.assertEqual([call.args[0] for call in client.rpc.call_args_list], ['eth_getTransactionCount', 'eth_getTransactionCount'])

    def test_imported_deployment_dependency_change_invalidates_success_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            seed_path = path / 'seed.json'
            seed_path.write_text(json.dumps(seed_fixture()))
            args = SimpleNamespace(source_root=Path(__file__).resolve().parents[2], seed_route=seed_path, rehearsal=path / 'proof.json')
            config, deployment, seed, original = phase.read_inputs(args)
            self.assertIn('deploy-xlayer-test.py', original['sourceSha256'])
            self.assertIn('rehearse-xlayer-test.py', original['sourceSha256'])
            args.rehearsal.write_text(json.dumps({'status': 'localhost-pool-rehearsal-passed', 'pins': original}))
            read = Path.read_bytes
            def altered(p):
                value = read(p)
                return value + b'\n# changed' if p.name == 'deploy-xlayer-test.py' else value
            with patch.object(Path, 'read_bytes', altered):
                changed = phase.read_inputs(args)[3]
            self.assertNotEqual(original, changed)
            with self.assertRaisesRegex(ValueError, 'inputs/source changed'):
                phase.execute(args, config, deployment, seed, changed)


if __name__ == '__main__':
    unittest.main()

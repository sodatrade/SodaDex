"""Offline continuation invariants: no network, wallet, signing or remote writes."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import brand_plan as plan
import brand_chain as chain
import pool_plan as pool

SPEC = importlib.util.spec_from_file_location('brand_phase', Path(__file__).with_name('brand-phase.py'))
phase = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(phase)
ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / 'deployments/xlayer-test/plan.json').read_text())
PRIOR = json.loads((ROOT / 'deployments/xlayer-test/pools-interrupted.json').read_text())
OWNER = CONFIG['owner']


def market():
    return {'ok': True, 'data': [{'action': 'ok', 'reason': '', 'chainIndex': '196', 'contextSlot': 100,
        'swapMode': 'exactIn', 'fromTokenAmount': str(pool.BUY), 'toTokenAmount': '11924',
        'fromToken': {'tokenContractAddress': '0x' + 'ee' * 20, 'decimal': '18'},
        'toToken': {'tokenContractAddress': pool.STABLE, 'decimal': '6'}}]}


def tx(value=0, gas=100, price=21, to=pool.STABLE):
    return {'chainId': 196, 'from': OWNER, 'to': to, 'nonce': '0x10', 'gas': hex(gas),
            'gasPrice': hex(price), 'value': hex(value), 'data': '0x1234'}


class ContinuationMathTests(unittest.TestCase):
    def test_spent_seed_is_not_bought_again_and_all_gross_caps_still_add_to_original_limit(self):
        self.assertNotIn('seed', plan.STEPS)
        self.assertEqual(len(plan.STEPS), 18)
        future = [tx(pool.LP_NATIVE), tx(pool.LP_NATIVE), tx(pool.FORWARD), tx(pool.FORWARD)]
        result = plan.budget([], future, PRIOR, pool.GAS_CAP)
        self.assertEqual(result['grossPrincipalWei'], pool.PRINCIPAL_CAP)
        self.assertEqual(result['gasSpentWei'], 7084791000000)
        with self.assertRaisesRegex(ValueError, 'gross native principal'):
            plan.budget([], future + [tx(1)], PRIOR, pool.GAS_CAP)

    def test_rehearsal_reports_full_cost_over_budget_but_execution_gate_rejects(self):
        future = [tx(gas=25_000_000, price=21_000_000)]
        report = plan.budget([], future, PRIOR, pool.GAS_CAP, enforce=False)
        self.assertTrue(report['needsBudgetApproval'])
        self.assertEqual(report['maximumTotalGasWei'], 25_000_000 * 21_000_000 + 7084791000000)
        with self.assertRaisesRegex(ValueError, 'explicit new approval'):
            plan.budget([], future, PRIOR, pool.GAS_CAP)
        approved = plan.gas_wei('0.0006')
        self.assertFalse(plan.budget([], future, PRIOR, approved)['needsBudgetApproval'])

    def test_pending_reserved_caps_are_not_credited_with_refunds(self):
        row = {'unsigned': tx(pool.LP_NATIVE, gas=100)}
        result = plan.budget([row], [tx(pool.FORWARD, gas=300)], PRIOR, pool.GAS_CAP)
        self.assertEqual(result['remainingGasCapWei'], 400 * 21)
        with self.assertRaisesRegex(ValueError, 'Insufficient balance'):
            plan.budget([row], [], PRIOR, pool.GAS_CAP, balance=pool.LP_NATIVE + 2099)

    def test_fresh_market_context_uses_actual_seed_units_and_freezes_integer_math(self):
        ctx = plan.quote_context(market(), CONFIG, 11844, 101, 1800000000, quote_timestamp=1800000000)
        with self.assertRaisesRegex(ValueError, 'quote block is stale'):
            plan.quote_context(market(), CONFIG, 11844, 101, 1800000601, quote_timestamp=1800000000)
        self.assertEqual(ctx['stableCap'], 5822)
        self.assertEqual(2 * ctx['stableCap'] + 200, 11844)
        plan.validate_context(ctx, CONFIG)
        changed = copy.deepcopy(ctx)
        changed['sqrt3'] += 1
        with self.assertRaisesRegex(ValueError, 'Frozen'):
            plan.validate_context(changed, CONFIG)
        for value in (1, 99, 100, 117, 11924):
            self.assertLessEqual((value - pool.min_output(value)) * 10000, value * 50)

    def test_market_quote_wrong_chain_asset_precision_amount_and_future_block_fail(self):
        mutations = [lambda q: q.update(action='block'), lambda q: q.update(chainIndex='1'),
            lambda q: q.update(fromTokenAmount='1'), lambda q: q.update(contextSlot=102),
            lambda q: q['toToken'].update(decimal='18'), lambda q: q['toToken'].update(tokenContractAddress=OWNER),
            lambda q: q['fromToken'].update(tokenContractAddress=CONFIG['wrappedNative'])]
        for mutation in mutations:
            quote = market()
            mutation(quote['data'][0])
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                plan.quote_context(quote, CONFIG, 11844, 101, 1800000000, quote_timestamp=1800000000)
        with self.assertRaisesRegex(ValueError, 'balance changed'):
            plan.quote_context(market(), CONFIG, 11843, 101, 1800000000, quote_timestamp=1800000000)

    def test_finite_allowance_reset_targets_old_npm_not_new_and_never_moves_principal(self):
        config = copy.deepcopy(CONFIG)
        config['contracts']['v3PositionManager'] = OWNER
        with patch.object(pool, 'calldata', return_value='0xfixture') as abi:
            row = plan.build('revokeOldV3', CONFIG, config, {}, None, 600)
            abi.assert_called_once_with('approve(address,uint256)', CONFIG['contracts']['v3PositionManager'], 0)
            self.assertEqual(row['value'], 0)
            self.assertEqual(row['to'], pool.STABLE)


class TransactionTests(unittest.TestCase):
    def test_creation_and_call_signed_envelopes_bind_all_fields(self):
        for destination in (None, pool.STABLE):
            row = {'unsigned': tx(1, to=destination), 'raw': 'private-fixture', 'hash': '0xabc'}
            actual = {'chainId': 196, 'signer': OWNER, 'to': destination, 'nonce': 16, 'gas': 100,
                      'gasPrice': 21, 'value': 1, 'type': 0, 'input': '0x1234'}
            chain.validate_signed(row, lambda _: actual, lambda _: '0xabc')
            for key, bad in [('chainId', 1), ('signer', pool.STABLE), ('to', OWNER), ('nonce', 17),
                             ('gas', 99), ('gasPrice', 22), ('value', 0), ('type', 2), ('input', '0xdead')]:
                with self.subTest(destination=destination, field=key), self.assertRaises(ValueError):
                    chain.validate_signed(row, lambda _: {**actual, key: bad}, lambda _: '0xabc')

    def test_creation_mktx_uses_create_not_none_destination(self):
        with patch.object(chain, 'cast', return_value='0xencoded') as cast:
            chain.mktx(tx(to=None))
            self.assertEqual(cast.call_args.args[-2:], ('--create', '0x1234'))
            self.assertNotIn('--keystore', cast.call_args.args)

    def test_runtime_proof_masks_only_declared_immutables(self):
        artifact = {'runtime': 'aabb0000ccdd', 'runtimeLinks': {},
                    'immutableReferences': {'1': [{'start': 2, 'length': 2}]}}
        chain.runtime_matches_artifact('0xaabb1234ccdd', artifact, {})
        with self.assertRaisesRegex(ValueError, 'differs outside'):
            chain.runtime_matches_artifact('0xaabb1234ccee', artifact, {})
        with self.assertRaisesRegex(ValueError, 'length'):
            chain.runtime_matches_artifact('0xaabb', artifact, {})

    def test_library_self_address_patch_is_exactly_the_expected_create_address(self):
        artifact = {'runtime': '73' + '00' * 20 + '3014aabb', 'runtimeLinks': {}, 'immutableReferences': {}}
        deployed = '0x73' + OWNER[2:] + '3014aabb'
        chain.runtime_matches_artifact(deployed, artifact, {}, library_address=OWNER)
        with self.assertRaisesRegex(ValueError, 'differs outside'):
            chain.runtime_matches_artifact(deployed, artifact, {}, library_address=pool.STABLE)
        with self.assertRaisesRegex(ValueError, 'Unknown library'):
            chain.runtime_matches_artifact('0x1234', {**artifact, 'runtime': '1234'}, {}, library_address=OWNER)

    def test_creation_receipt_accepts_null_destination_and_checks_predicted_address(self):
        row = {'unsigned': tx(to=None), 'hash': '0xabc', 'intent': {'expectedAddress': OWNER}}
        receipt = {'transactionHash': '0xabc', 'from': OWNER, 'to': None, 'contractAddress': OWNER,
                   'status': '0x1', 'gasUsed': '0x64', 'effectiveGasPrice': '0x15',
                   'blockNumber': '0x64', 'blockHash': '0xblock'}
        client = Mock(local=True)
        client.rpc.side_effect = [receipt, {'hash': '0xblock'}]
        client.call.return_value = '0x0'
        self.assertEqual(chain.receipt(client, row), receipt)
        client.rpc.side_effect = [{**receipt, 'contractAddress': pool.STABLE}, {'hash': '0xblock'}]
        with self.assertRaisesRegex(ValueError, 'CREATE address'):
            chain.receipt(client, row)

    def test_read_only_client_forbids_all_remote_mutation(self):
        client = chain.Chain()
        for method in ('eth_sendRawTransaction', 'eth_sendTransaction', 'anvil_setBalance', 'personal_sign'):
            with self.subTest(method=method), self.assertRaises(ValueError):
                client.rpc(method)

    def test_durable_journal_keeps_private_bytes_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'journal.json'
            chain.save(path, {'raw': 'private-fixture'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {'raw': 'private-fixture'})


class RecoveryTests(unittest.TestCase):
    def journal(self):
        return {'ownerNonce': 16, 'context': None, 'rows': [{'name': plan.STEPS[0],
            'raw': 'durable-fixture', 'hash': '0xabc', 'unsigned': {'nonce': '0x10'},
            'intent': {'expectedAddress': OWNER}, 'contextAtBuild': None, 'before': {'native': 100}}]}

    def recover(self, client, found, gate=None, journal=None):
        journal = journal or self.journal()
        with tempfile.TemporaryDirectory() as directory, patch.object(plan, 'validate_row'), \
             patch.object(phase, 'validate_signed'), patch.object(phase, 'receipt', return_value=found), \
             patch.object(phase, 'postcondition', return_value={}), \
             patch.object(phase, 'wait_receipt', return_value={'blockHash': '0xblock'}) as wait, \
             patch.object(phase, 'unsent_gate', side_effect=gate) as unsent:
            phase.reconcile(client, Path(directory) / 'journal.json', journal, CONFIG, {}, PRIOR, CONFIG, {}, {})
            return wait, unsent, journal

    def test_mined_transaction_recovers_without_rebroadcast_or_resigning(self):
        client = Mock()
        wait, unsent, journal = self.recover(client, {'blockHash': '0xblock'})
        self.assertEqual(journal['rows'][0]['receipt']['blockHash'], '0xblock')
        wait.assert_not_called()
        unsent.assert_not_called()
        client.rpc.assert_not_called()

    def test_known_pending_expired_transaction_is_waited_without_replacement(self):
        client = Mock()
        client.rpc.return_value = {'hash': '0xabc', 'blockNumber': None}
        journal = self.journal()
        journal['rows'][0]['intent']['deadline'] = 1
        wait, unsent, _ = self.recover(client, None, journal=journal)
        wait.assert_called_once()
        unsent.assert_not_called()
        self.assertEqual([call.args[0] for call in client.rpc.call_args_list], ['eth_getTransactionByHash'])

    def test_unknown_expired_intent_cannot_be_rebroadcast(self):
        client = Mock()
        client.rpc.return_value = None
        with self.assertRaisesRegex(ValueError, 'expired'):
            self.recover(client, None, ValueError('expired'))
        self.assertNotIn('eth_sendRawTransaction', [call.args[0] for call in client.rpc.call_args_list])

    def test_confirmed_receipt_disappearance_halts_without_new_transaction(self):
        journal = self.journal()
        journal['rows'][0]['receipt'] = {'blockHash': '0xblock'}
        client = Mock()
        with self.assertRaisesRegex(ValueError, 'disappeared'):
            self.recover(client, None, journal=journal)
        client.rpc.assert_not_called()

    def test_context_tampering_stops_before_receipt_or_send(self):
        journal = self.journal()
        journal['rows'][0]['contextAtBuild'] = {'different': True}
        with self.assertRaisesRegex(ValueError, 'market context changed'):
            self.recover(Mock(), None, journal=journal)

    def test_budget_rejection_precedes_wallet_access_or_any_remote_write(self):
        args = SimpleNamespace(rehearsal=Path('/unused'))
        prepared = {'transactions': [{'unsigned': tx(gas=25_000_000, price=21_000_000)}]}
        client = Mock()
        client.rpc.return_value = hex(21_000_000)
        with patch.object(Path, 'read_text', return_value=json.dumps(prepared)), \
             patch.object(Path, 'exists', return_value=False), patch.object(phase, 'ensure_prepared', return_value=CONFIG), \
             patch.object(phase, 'Chain', return_value=client), patch.object(phase, 'cast') as wallet, \
             self.assertRaisesRegex(ValueError, 'explicit new approval'):
            phase.execute(args, CONFIG, {}, PRIOR, {}, {}, {'policy': {'gasCapWei': pool.GAS_CAP}})
        wallet.assert_not_called()
        self.assertEqual([call.args[0] for call in client.rpc.call_args_list], ['eth_gasPrice'])


if __name__ == '__main__':
    unittest.main()

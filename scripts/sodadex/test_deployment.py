"""Offline deployment invariants; never reads a wallet or contacts an RPC."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('deployment', Path(__file__).with_name('deploy-xlayer-test.py'))
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
OWNER = '0x' + '11' * 20


class DeploymentInvariants(unittest.TestCase):
    def row(self):
        return {'name': 'example', 'unsigned': {'chainId': 196, 'from': OWNER, 'nonce': '0x0',
                'gas': '0x64', 'value': '0x0', 'data': '0x6000'}, 'gasPriceWei': 21,
                'raw': 'private-signed-fixture', 'hash': '0x1234'}

    def decoded(self):
        return {'signer': OWNER, 'chainId': '0xc4', 'nonce': '0x0', 'gas': '0x64',
                'gasPrice': '0x15', 'value': '0x0', 'type': '0x0', 'to': None, 'input': '0x6000'}

    def test_signed_intent_fields_are_checked_before_network_write(self):
        for key, invalid in [('signer', '0x' + '22' * 20), ('chainId', 1), ('nonce', 1),
                             ('gas', 101), ('gasPrice', 22), ('value', 1), ('type', 2),
                             ('to', OWNER), ('input', '0x6001')]:
            with self.subTest(field=key):
                decoded = {**self.decoded(), key: invalid}
                with self.assertRaises(ValueError):
                    deploy.validate_signed(self.row(), OWNER, lambda _: decoded, lambda _: '0x1234')

    def test_valid_signed_intent_and_hash(self):
        deploy.validate_signed(self.row(), OWNER, lambda _: self.decoded(), lambda _: '0x1234')
        with self.assertRaises(ValueError):
            deploy.validate_signed(self.row(), OWNER, lambda _: self.decoded(), lambda _: '0x5678')

    def test_budget_includes_confirmed_cost_and_all_remaining_gas_caps(self):
        confirmed = {**self.row(), 'receipt': {'gasUsed': '0x32', 'effectiveGasPrice': '0x15', 'l1Fee': '0x0'}}
        self.assertEqual(deploy.budget_check([confirmed, self.row()], 3150), (1050, 2100))
        with self.assertRaises(ValueError):
            deploy.budget_check([confirmed, self.row()], 3149)

    def test_nonzero_receipt_operator_or_data_fees_stop_further_spending(self):
        for field in ['l1Fee', 'operatorFee', 'operatorFeeScalar', 'operatorFeeConstant']:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'additional fees changed'):
                deploy.receipt_cost({'gasUsed': '0x64', 'effectiveGasPrice': '0x1', field: '0x7'})

    def test_oracle_upgrade_is_detected_even_when_proxy_code_is_unchanged(self):
        proxy = '0x6000'
        implementation = '0x6001'
        journal = {'oracleCodeSha256': deploy.sha(bytes.fromhex(proxy[2:])),
                   'oracleImplementation': {'address': OWNER, 'codeSha256': 'old-implementation-hash'}}

        def read(method, params=()):
            if method == 'eth_chainId': return '0xc4'
            if method == 'eth_blockNumber': return '0x1'
            if method == 'eth_getStorageAt': return '0x' + OWNER[2:].rjust(64, '0')
            if method == 'eth_getCode': return proxy if params[0] == deploy.ORACLE else implementation
            raise AssertionError('Unexpected RPC request')

        with patch.object(deploy, 'rpc', side_effect=read), self.assertRaisesRegex(ValueError, 'proxy implementation changed'):
            deploy.live_gate({'owner': OWNER}, journal)

    def test_unknown_or_pending_nonce_cannot_be_replaced(self):
        deploy.nonce_gate(3, 3, 3)
        for latest, pending in [(3, 4), (4, 4), (2, 3)]:
            with self.subTest(latest=latest, pending=pending), self.assertRaises(ValueError):
                deploy.nonce_gate(latest, pending, 3)

    def test_resume_detects_intent_tampering(self):
        row = self.row()
        journal = {'prepared': {'transactions': [copy.deepcopy(row)]}, 'rows': [row]}
        deploy.validate_rows(journal)
        row['unsigned']['nonce'] = '0x1'
        with self.assertRaises(ValueError):
            deploy.validate_rows(journal)

    def test_response_loss_keeps_exact_signed_bytes_private_and_durable(self):
        row = self.row()
        journal = {'rows': [row]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'journal.json'

            def lost_response(method, params):
                self.assertEqual(method, 'eth_sendRawTransaction')
                self.assertEqual(json.loads(path.read_text())['rows'][0]['raw'], params[0])
                raise TimeoutError('response lost')

            with self.assertRaises(TimeoutError):
                deploy.broadcast_saved(path, journal, row, lost_response)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())['rows'][0]['hash'], '0x1234')

    def test_resume_recovers_mined_receipt_before_reserving_remaining_gas(self):
        journal = {'rows': [self.row(), {**self.row(), 'raw': None}]}
        receipt = {'gasUsed': '0x32', 'effectiveGasPrice': '0x15'}
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, 'validate_signed'), patch.object(deploy, 'check_receipt', return_value=receipt):
            path = Path(directory) / 'journal.json'
            deploy.reconcile_saved(path, journal, {'owner': OWNER})
            spent, remaining = deploy.budget_check(journal['rows'], 4200)
            self.assertEqual((spent, remaining), (1050, 2100))
            self.assertLessEqual(remaining, 4200 - spent)
            self.assertEqual(json.loads(path.read_text())['rows'][0]['receipt'], receipt)

    def test_reverted_receipt_never_counts_as_success(self):
        row = self.row()
        receipt = {'transactionHash': row['hash'], 'from': OWNER, 'status': '0x0', 'blockNumber': '0x1'}
        with patch.object(deploy, 'rpc', side_effect=[receipt, '0x3']), self.assertRaisesRegex(ValueError, 'reverted'):
            deploy.check_receipt(row, {'owner': OWNER})

    def test_sequencer_preconfirmation_is_not_a_final_receipt(self):
        row = self.row()
        receipt = {'blockNumber': '0x2'}
        with patch.object(deploy, 'rpc', side_effect=[receipt, '0x2']):
            self.assertIsNone(deploy.check_receipt(row, {'owner': OWNER}))

    def test_reorganized_receipt_never_counts_as_success(self):
        row = {**self.row(), 'localReceipt': {'contractAddress': None}}
        receipt = {'transactionHash': row['hash'], 'from': OWNER, 'status': '0x1', 'to': None,
                   'contractAddress': None, 'gasUsed': '0x32', 'effectiveGasPrice': '0x15',
                   'blockNumber': '0x1', 'blockHash': '0x1111'}
        with patch.object(deploy, 'rpc', side_effect=[receipt, '0x3', {'hash': '0x2222'}]), self.assertRaisesRegex(ValueError, 'canonical'):
            deploy.check_receipt(row, {'owner': OWNER})


if __name__ == '__main__':
    unittest.main()

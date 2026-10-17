import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("mining_testnet", Path(__file__).with_name("check-mining-testnet.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

OWNER = "0x6ecf746b078d46391f8C425B150153212F7C0545"
CONTRACT = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
BLOCK_HASH = "0x" + "11" * 32


class ReadinessTest(unittest.TestCase):
    def manifest(self):
        return {"schemaVersion": 1, "chainId": 1952, "owner": OWNER,
                "dependencies": [{"role": "fab", "address": None}]}

    def rpc(self, method, params):
        return {"eth_chainId": "0x7a0", "eth_blockNumber": "0x20",
                "eth_getBlockByNumber": {"number": "0x20", "hash": BLOCK_HASH},
                "eth_getBalance": "0x1", "eth_getCode": "0x6000"}[method]

    def test_rejects_mainnet_manifest_before_network_access(self):
        manifest = self.manifest()
        manifest["chainId"] = 196
        def no_rpc(method, params):
            self.fail("Wrong-chain manifest reached RPC")
        with self.assertRaises(ValueError):
            MODULE.check(manifest, no_rpc)

    def test_rejects_mainnet_rpc_before_balance_or_code_reads(self):
        calls = []
        def mainnet_rpc(method, params):
            calls.append(method)
            return "0xc4"
        with self.assertRaises(ValueError):
            MODULE.check(self.manifest(), mainnet_rpc)
        self.assertEqual(calls, ["eth_chainId"])

    def test_missing_dependencies_are_not_ready_even_with_funded_owner(self):
        result = MODULE.check(self.manifest(), self.rpc)
        self.assertEqual(result["ownerBalanceWei"], "1")
        self.assertEqual(result["dependencies"][0]["status"], "not-configured")
        self.assertFalse(result["configuredDependenciesReady"])
        self.assertFalse(result["broadcastPerformed"])

    def test_code_presence_alone_does_not_establish_identity(self):
        manifest = self.manifest()
        item = manifest["dependencies"][0]
        item["address"] = CONTRACT
        result = MODULE.check(manifest, self.rpc)
        self.assertEqual(result["dependencies"][0]["status"], "runtime-unpinned")
        item["expectedRuntimeSha256"] = result["dependencies"][0]["runtimeSha256"]
        result = MODULE.check(manifest, self.rpc)
        self.assertEqual(result["dependencies"][0]["status"], "source-verification-pending")
        self.assertFalse(result["configuredDependenciesReady"])
        item["sourceVerified"] = True
        self.assertTrue(MODULE.check(manifest, self.rpc)["configuredDependenciesReady"])

    def test_absent_or_changed_runtime_blocks_readiness(self):
        manifest = self.manifest()
        manifest["dependencies"][0].update(address=CONTRACT, expectedRuntimeSha256="wrong", sourceVerified=True)
        self.assertEqual(MODULE.check(manifest, self.rpc)["dependencies"][0]["status"], "runtime-mismatch")
        def no_code(method, params):
            return "0x" if method == "eth_getCode" else self.rpc(method, params)
        result = MODULE.check(manifest, no_code)
        self.assertEqual(result["dependencies"][0]["status"], "no-code")
        self.assertFalse(result["configuredDependenciesReady"])

    def test_changed_pinned_block_discards_the_observation(self):
        reads = 0
        def reorg(method, params):
            nonlocal reads
            if method == "eth_getBlockByNumber":
                reads += 1
                return {"number": "0x20", "hash": BLOCK_HASH if reads == 1 else "0x" + "22" * 32}
            return self.rpc(method, params)
        with self.assertRaisesRegex(ValueError, "Pinned block changed"):
            MODULE.check(self.manifest(), reorg)

    def test_unfunded_owner_blocks_otherwise_verified_dependencies(self):
        manifest = self.manifest()
        manifest["dependencies"][0].update(address=CONTRACT, sourceVerified=True,
            expectedRuntimeSha256=MODULE.hashlib.sha256(bytes.fromhex("6000")).hexdigest())
        def unfunded(method, params):
            return "0x0" if method == "eth_getBalance" else self.rpc(method, params)
        result = MODULE.check(manifest, unfunded)
        self.assertEqual(result["dependencies"][0]["status"], "verified-runtime")
        self.assertFalse(result["configuredDependenciesReady"])

    def test_malformed_block_evidence_is_rejected(self):
        def invalid_hash(method, params):
            if method == "eth_getBlockByNumber":
                return {"number": "0x20", "hash": "not-a-block-hash"}
            return self.rpc(method, params)
        with self.assertRaisesRegex(ValueError, "valid block"):
            MODULE.check(self.manifest(), invalid_hash)
        reads = 0
        def wrong_number(method, params):
            nonlocal reads
            if method == "eth_getBlockByNumber":
                reads += 1
                return {"number": "0x20" if reads == 1 else "0x21", "hash": BLOCK_HASH}
            return self.rpc(method, params)
        with self.assertRaisesRegex(ValueError, "Pinned block"):
            MODULE.check(self.manifest(), wrong_number)

    def test_rpc_rejects_wrong_protocol_or_response_id(self):
        for payload in ("{\"jsonrpc\":\"2.0\",\"id\":99,\"result\":\"0x7a0\"}",
                        "{\"jsonrpc\":\"wrong\",\"id\":1,\"result\":\"0x7a0\"}"):
            with patch.object(MODULE, "urlopen", return_value=io.StringIO(payload)):
                with self.assertRaisesRegex(ValueError, "request ID"):
                    MODULE.rpc_read(MODULE.RPC_URLS[0], "eth_chainId", [])

    def test_signing_and_broadcast_methods_never_reach_transport(self):
        for method in ("eth_sendRawTransaction", "eth_sendTransaction", "personal_sign"):
            with patch.object(MODULE, "urlopen") as transport:
                with self.assertRaisesRegex(ValueError, "Only read"):
                    MODULE.rpc_read(MODULE.RPC_URLS[0], method, [])
                transport.assert_not_called()


if __name__ == "__main__":
    unittest.main()

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from mining_source import foundry_env
from fee_policy import PROFILES, require_test_profile

SPEC = importlib.util.spec_from_file_location("mining_preparation", Path(__file__).with_name("prepare-mining-dependencies.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PreparationTest(unittest.TestCase):
    def test_production_fee_profile_stops_before_rpc_source_or_forge(self):
        arguments = ["prepare", "--fabx-source", "/unused", "--output", "/unused-output",
                     "--fee-profile", str(PROFILES["production"])]
        with patch("sys.argv", arguments), patch.object(MODULE.READINESS, "rpc_read") as read, \
                patch.object(MODULE, "source_snapshot") as source, patch.object(MODULE.subprocess, "run") as forge:
            with self.assertRaisesRegex(ValueError, "Invalid 1952 test fee profile"):
                MODULE.main()
        read.assert_not_called()
        source.assert_not_called()
        forge.assert_not_called()

    def test_successful_preparation_records_checked_fee_digest_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "evidence"
            arguments = ["prepare", "--fabx-source", "/unused", "--output", str(output)]
            result = type("Result", (), {"returncode": 0, "stderr": "", "stdout":
                          "\n".join(json.dumps(item) for item in self._simulation())})()
            with patch("sys.argv", arguments), patch.object(MODULE, "preflight", return_value=10**18), \
                    patch.object(MODULE, "source_snapshot", return_value=Path("/snapshot")), \
                    patch.object(MODULE, "foundry_env", return_value={}), \
                    patch.object(MODULE.subprocess, "run", return_value=result), patch("builtins.print"):
                self.assertEqual(MODULE.main(), 0)
            metadata = json.loads((output / "metadata.json").read_text())
            self.assertEqual(metadata["feeConfigurationSha256"], require_test_profile(PROFILES["test"])["configurationSha256"])
            self.assertFalse(metadata["signed"])
            self.assertFalse(metadata["broadcastPerformed"])

    def test_mainnet_response_stops_before_balance_and_forge(self):
        calls = []
        def read(url, method, params):
            calls.append(method)
            return "0xc4"
        with self.assertRaisesRegex(ValueError, "1952"):
            MODULE.preflight(MODULE.READINESS.RPC_URLS[0], read)
        self.assertEqual(calls, ["eth_chainId"])

    def test_unknown_endpoint_is_never_contacted(self):
        def read(*args):
            self.fail("Unapproved endpoint reached")
        with self.assertRaises(ValueError):
            MODULE.preflight("https://rpc.ignix.bot/rpc/196", read)
        with self.assertRaises(ValueError):
            MODULE.simulation_command(Path("/work"), "https://rpc.ignix.bot/rpc/196")

    def test_credential_and_rpc_variables_are_not_inherited(self):
        with patch.dict(os.environ, {"PRIVATE_KEY": "test-canary", "XLAYER_RPC_URL": "test-canary",
                                     "FOUNDRY_FFI": "true", "FOUNDRY_BROADCAST": "wrong"}):
            result = foundry_env(Path("/work"), Path("/snapshot"))
        self.assertNotIn("PRIVATE_KEY", result)
        self.assertNotIn("XLAYER_RPC_URL", result)
        self.assertEqual(result["FOUNDRY_FFI"], "false")
        self.assertEqual(result["FOUNDRY_BROADCAST"], "/work/.analysis/mining-1952/unsigned-dry-run")
        self.assertTrue(all(value.startswith("/") for value in
                            (line.split("=", 1)[1] for line in result["FOUNDRY_REMAPPINGS"].splitlines())))

    def test_unfunded_owner_stops_simulation(self):
        def read(url, method, params):
            return "0x7a0" if method == "eth_chainId" else "0x0"
        with self.assertRaisesRegex(ValueError, "not funded"):
            MODULE.preflight(MODULE.READINESS.RPC_URLS[0], read)

    def test_1952_plan_has_no_key_or_broadcast_option(self):
        command = MODULE.simulation_command(Path("/work"), MODULE.READINESS.RPC_URLS[0])
        for option in ("--broadcast", "--private-key", "--keystore", "--unlocked", "--resume", "--skip-simulation"):
            self.assertNotIn(option, command)
        self.assertEqual(command[command.index("--sender") + 1], MODULE.OWNER)
        self.assertEqual(command[command.index("--sig") + 1], "run()")
        self.assertIn("/work/contracts/mining-rehearsal/script/PrepareFabx1952.s.sol:PrepareFabx1952", command)

    def test_dotenv_in_either_foundry_working_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for folder in (root, root / "contracts/mining-rehearsal"):
                folder.mkdir(parents=True, exist_ok=True)
                dotenv = folder / ".env"
                dotenv.touch()
                with self.assertRaisesRegex(ValueError, "dotenv"):
                    foundry_env(root, root / "snapshot")
                dotenv.unlink()

    def _simulation(self):
        returned = "0x" + "".join(i.to_bytes(32, "big").hex() for i in range(1, 12))
        return [{"success": True, "returned": returned},
                {"chain": 1952, "estimated_amount_required": "0.001", "estimated_total_gas_used": 100},
                {"status": "success"}]

    def test_parse_stream_keeps_estimates_separate_from_real_deployment(self):
        stream = "\n".join(json.dumps(item) for item in self._simulation())
        plan = MODULE.simulation_result(stream)
        self.assertEqual(plan["estimatedRequiredWei"], "1000000000000000")
        self.assertEqual(len(plan["proposedAddresses"]), 11)
        self.assertFalse(plan["deployed"])
        self.assertEqual(plan["nativeCurrency"], "TEST OKB")

    def test_failed_partial_or_wrong_chain_simulation_is_not_a_deployment_plan(self):
        failed = self._simulation()
        failed[0]["success"] = False
        wrong_chain = self._simulation()
        wrong_chain[1]["chain"] = 196
        truncated = self._simulation()
        truncated[0]["returned"] = "0x00"
        for objects in (failed, wrong_chain, truncated, self._simulation()[:1]):
            with self.assertRaises(ValueError):
                MODULE.simulation_result("\n".join(json.dumps(item) for item in objects))

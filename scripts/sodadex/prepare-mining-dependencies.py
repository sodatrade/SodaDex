#!/usr/bin/env python3
"""Simulate proposed FABX dependencies on 1952, without any signing/broadcast option."""

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
from mining_source import FABX_SOURCE, foundry_env, source_snapshot
from fee_policy import PROFILES, require_test_profile

SPEC = importlib.util.spec_from_file_location("mining_readiness", Path(__file__).with_name("check-mining-testnet.py"))
READINESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READINESS)
OWNER = "0x6ecf746b078d46391f8C425B150153212F7C0545"


def preflight(url, read):
    if url not in READINESS.RPC_URLS:
        raise ValueError("Only the official 1952 endpoints are allowed")
    if int(read(url, "eth_chainId", []), 16) != 1952:
        raise ValueError("Not chain 1952; no simulation was started")
    balance = int(read(url, "eth_getBalance", [OWNER, "latest"]), 16)
    if balance == 0:
        raise ValueError("1952 test owner is not funded")
    return balance


def simulation_command(root, url):
    if url not in READINESS.RPC_URLS:
        raise ValueError("Only the official 1952 endpoints are allowed")
    return ["forge", "script", "--root", str(root / "contracts/mining-rehearsal"),
            str(root / "contracts/mining-rehearsal/script/PrepareFabx1952.s.sol") + ":PrepareFabx1952", "--sig", "run()",
            "--sender", OWNER, "--rpc-url", url, "--json"]


def simulation_result(stdout):
    # Forge emits a JSON stream (execution, estimate, completion), not one JSON document.
    decoder = json.JSONDecoder()
    objects = []
    offset = 0
    while offset < len(stdout):
        offset = len(stdout) - len(stdout[offset:].lstrip())
        if offset == len(stdout):
            break
        item, offset = decoder.raw_decode(stdout, offset)
        if not isinstance(item, dict):
            raise ValueError("Unexpected simulation JSON")
        objects.append(item)
    if len(objects) < 3 or objects[0].get("success") is not True or objects[-1].get("status") != "success":
        raise ValueError("No complete successful simulation")
    quotes = [item for item in objects if "estimated_amount_required" in item]
    if len(quotes) != 1 or quotes[0].get("chain") != 1952:
        raise ValueError("Simulation gas estimate is not for 1952")
    quote = quotes[0]
    if type(quote.get("estimated_total_gas_used")) is not int or quote["estimated_total_gas_used"] <= 0:
        raise ValueError("Invalid gas estimate")
    required = Decimal(quote["estimated_amount_required"]) * 10**18
    if not required.is_finite() or required < 0 or required != required.to_integral_value():
        raise ValueError("Invalid raw gas budget")
    roles = ["transistorsImplementation", "circuitsImplementation", "factoryImplementation", "factory",
             "miningImplementation", "mining", "fab", "transistors", "circuits", "circuitMarket", "lens"]
    returned = objects[0].get("returned")
    if not isinstance(returned, str) or not returned.startswith("0x"):
        raise ValueError("Missing dependency return data")
    raw = bytes.fromhex(returned[2:])
    if len(raw) != 32 * len(roles):
        raise ValueError("Dependency return ABI changed")
    addresses = {}
    for index, role in enumerate(roles):
        word = raw[index * 32:(index + 1) * 32]
        if word[:12] != bytes(12):
            raise ValueError("Invalid dependency address encoding")
        addresses[role] = READINESS.address("0x" + word[12:].hex())
    if len(set(addresses.values())) != len(roles):
        raise ValueError("Duplicate proposed dependency address")
    return {"proposedAddresses": addresses, "estimatedGas": quote["estimated_total_gas_used"],
            "estimatedRequiredWei": str(int(required)), "nativeCurrency": "TEST OKB",
            "deployed": False, "scope": "Unsigned simulation only; not a deployment address manifest"}


def main():
    from mining_source import require_legacy_rehearsal
    require_legacy_rehearsal(Path(__file__).resolve().parents[2])
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fabx-source", type=Path, required=True)
    parser.add_argument("--rpc", choices=READINESS.RPC_URLS, default=READINESS.RPC_URLS[0])
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory; never overwritten")
    parser.add_argument("--fee-profile", type=Path, default=PROFILES["test"])
    args = parser.parse_args()
    fees = require_test_profile(args.fee_profile)
    balance = preflight(args.rpc, READINESS.rpc_read)
    snapshot = source_snapshot(root, args.fabx_source)
    args.output.mkdir(parents=True, exist_ok=False)
    command = simulation_command(root, args.rpc)
    result = subprocess.run(command, cwd=root, env=foundry_env(root, snapshot),
                            capture_output=True, text=True, check=False)
    (args.output / "stdout.jsonl").write_text(result.stdout)
    (args.output / "stderr.log").write_text(result.stderr)
    metadata = {"checkedAtUtc": datetime.now(timezone.utc).isoformat(), "chainId": 1952,
                "sourceCommit": FABX_SOURCE, "owner": OWNER, "ownerBalanceWei": str(balance),
                "simulationExitCode": result.returncode, "broadcastPerformed": False,
                "signed": False, "command": command,
                "scriptSha256": hashlib.sha256((root / "contracts/mining-rehearsal/script/PrepareFabx1952.s.sol").read_bytes()).hexdigest(),
                "scope": "Proposed test dependencies only; addresses in simulation are NOT deployed"}
    metadata["feeConfigurationSha256"] = fees["configurationSha256"]
    metadata["feeConfigurationScope"] = "Lowest test parameters checked; only base setup fees are implemented by this script"
    exit_code = result.returncode
    if exit_code == 0:
        try:
            plan = simulation_result(result.stdout)
            plan["fundingSufficient"] = balance >= int(plan["estimatedRequiredWei"])
            (args.output / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
            metadata["successfulSimulationValidated"] = True
        except (ValueError, KeyError, TypeError, ArithmeticError):
            metadata["successfulSimulationValidated"] = False
            exit_code = 2
    (args.output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

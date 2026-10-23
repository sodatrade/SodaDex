#!/usr/bin/env python3
"""Test actual FAB payout accounting and upgrade preservation in memory; never broadcast."""

import argparse
import json
from pathlib import Path
import subprocess

from fee_policy import PROFILES, require_test_profile
from mining_rewards_source import reward_source_snapshot
from mining_history_source import history_source_snapshot
from mining_source import foundry_env


def main():
    from mining_source import require_legacy_rehearsal
    require_legacy_rehearsal(Path(__file__).resolve().parents[2])
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fabx-source", type=Path, required=True)
    parser.add_argument("--history", action="store_true", help="Test the separate time-history V2 source")
    args = parser.parse_args()
    require_test_profile(PROFILES["test"])
    baseline, variant = (history_source_snapshot if args.history else reward_source_snapshot)(root, args.fabx_source)
    env = foundry_env(root, variant)
    env["FOUNDRY_REMAPPINGS"] += "\nfabx-baseline/=" + str(baseline) + "/"
    env["FOUNDRY_OUT"] = str(root / ".analysis/mining-1952/rewards-out")
    env["FOUNDRY_CACHE_PATH"] = str(root / ".analysis/mining-1952/rewards-cache")
    print(json.dumps({"variant": str(variant), "localOnly": True, "broadcast": False}), flush=True)
    selected = "FabxPaidRewardsTest|FabxPaidRewardsInvariantTest|FabxDependenciesRehearsalTest|PrepareFabx1952GuardTest|FabxHistoryMathTest"
    if args.history:
        selected += "|FabxRewardHistoryTest"
    return subprocess.run([
        "forge", "test", "--root", str(root / "contracts/mining-rehearsal"),
        "--extra-output", "storageLayout",
        "--match-contract", selected, "-vv",
    ], cwd=root, env=env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())

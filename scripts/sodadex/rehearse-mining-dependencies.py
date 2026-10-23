#!/usr/bin/env python3
"""Run a memory-only Foundry rehearsal using an exact FABX source snapshot; never broadcast."""

import argparse
import json
from pathlib import Path
import subprocess
from mining_source import FABX_SOURCE, foundry_env, source_snapshot


def main():
    from mining_source import require_legacy_rehearsal
    require_legacy_rehearsal(Path(__file__).resolve().parents[2])
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fabx-source", type=Path, required=True)
    args = parser.parse_args()
    snapshot = source_snapshot(root, args.fabx_source)
    test_env = foundry_env(root, snapshot)
    command = ["forge", "test", "--root", str(root / "contracts/mining-rehearsal"),
               "--match-contract", "FabxDependenciesRehearsalTest|PrepareFabx1952GuardTest", "-vv"]
    print(json.dumps({"sourceCommit": FABX_SOURCE, "localOnly": True, "broadcast": False}), flush=True)
    return subprocess.run(command, cwd=root, env=test_env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())

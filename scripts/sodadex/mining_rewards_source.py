"""Build a versioned, test-only FABX source variant without editing its upstream checkout."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from mining_source import FABX_SOURCE, source_snapshot

PATCHED_FILES = (
    "src/pod/PodMining.sol",
    "src/pod/lib/DewebRewardAccounting.sol",
    "src/pod/lib/DewebMiningExtension.sol",
)
STAMP = ".sodadex-paid-rewards.json"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_variant(base, variant, expected_patch_hash, expected_files):
    stamp = json.loads((variant / STAMP).read_text())
    if (stamp.get("baseCommit") != FABX_SOURCE or stamp.get("patchSha256") != expected_patch_hash
            or stamp.get("patchedFileSha256") != expected_files):
        raise ValueError("Reward source provenance changed; existing variant left untouched")
    baseline = {p.relative_to(base) for p in base.rglob("*") if p.is_file()}
    actual = {p.relative_to(variant) for p in variant.rglob("*") if p.is_file()}
    if actual != baseline | {Path(STAMP)}:
        raise ValueError("Reward source file set changed; existing variant left untouched")
    for relative in baseline:
        expected = expected_files.get(str(relative)) if str(relative) in PATCHED_FILES else sha256(base / relative)
        if sha256(variant / relative) != expected:
            raise ValueError("Reward source file changed: " + str(relative))
    return stamp


def reward_source_snapshot(root, fabx_source):
    base = source_snapshot(root, fabx_source)
    patch = root / "contracts/mining-rehearsal/patches/fabx-paid-rewards-v1.patch"
    patch_hash = sha256(patch)
    expected = json.loads(patch.with_suffix(".json").read_text())
    if (expected.get("baseCommit") != FABX_SOURCE or expected.get("patchSha256") != patch_hash
            or set(expected.get("patchedFileSha256", {})) != set(PATCHED_FILES)):
        raise ValueError("Reward patch does not match reviewed source provenance")
    variant = root / ".analysis/mining-1952/fabx-paid-rewards-v1"
    if not variant.exists():
        shutil.copytree(base, variant)
        # This checked-in patch changes only test-source reward accounting. No Git,
        # wallet, dotenv, RPC or production checkout is used by patch application.
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "--input", str(patch.resolve())], cwd=variant, check=True)
        stamp = {
            "baseCommit": FABX_SOURCE,
            "variant": "1952-paid-rewards-v1",
            "patchSha256": patch_hash,
            "patchedFileSha256": {name: sha256(variant / name) for name in PATCHED_FILES},
            "scope": "Test source only; does not upgrade any deployed implementation",
        }
        (variant / STAMP).write_text(json.dumps(stamp, indent=2) + "\n")
    verify_variant(base, variant, patch_hash, expected["patchedFileSha256"])
    return base, variant.resolve()

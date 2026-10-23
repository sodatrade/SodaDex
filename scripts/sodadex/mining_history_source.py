"""Derive content-addressed 1952 history variants; upstream and V1 remain immutable."""

import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from mining_rewards_source import reward_source_snapshot, sha256


def history_source_snapshot(root, fabx_source):
    baseline, paid = reward_source_snapshot(root, fabx_source)
    patch = root / "contracts/mining-rehearsal/patches/fabx-history-v2.patch"
    expected = json.loads(patch.with_suffix(".json").read_text())
    digest = sha256(patch)
    if expected.get("baseVariant") != "1952-paid-rewards-v1" or expected.get("patchSha256") != digest:
        raise ValueError("History source patch provenance mismatch")
    files = expected.get("patchedFileSha256", {})
    allowed = {"src/pod/lib/" + name + ".sol" for name in (
        "DewebRewardAccounting", "DewebMiningExtension", "FabxRewardHistory", "FabxHistoryMath")}
    if set(files) != allowed:
        raise ValueError("History patch changes an unexpected source file")
    for name in ("FabxRewardHistory", "FabxHistoryMath"):
        if sha256(root / "contracts/mining-rehearsal/src" / (name + ".sol")) != files["src/pod/lib/" + name + ".sol"]:
            raise ValueError("History library and reviewed patch differ")
    variant = root / ".analysis/mining-1952/fabx-history-v2" / digest
    stamp_name = ".sodadex-history.json"
    if not variant.exists():
        shutil.copytree(paid, variant)
        subprocess.run(["patch", "--batch", "--fuzz=0", "-p1", "--input", str(patch)], cwd=variant, check=True)
        (variant / stamp_name).write_text(json.dumps(expected, indent=2) + "\n")
    if json.loads((variant / stamp_name).read_text()) != expected:
        raise ValueError("History source stamp changed; left untouched")
    original = {p.relative_to(paid) for p in paid.rglob("*") if p.is_file()}
    actual = {p.relative_to(variant) for p in variant.rglob("*") if p.is_file()}
    if actual != original | {Path(p) for p in files} | {Path(stamp_name)}:
        raise ValueError("History source file set changed; left untouched")
    for relative in actual - {Path(stamp_name)}:
        target_hash = files.get(str(relative)) or sha256(paid / relative)
        if sha256(variant / relative) != target_hash:
            raise ValueError("History source file changed: " + str(relative))
    return baseline, variant.resolve()

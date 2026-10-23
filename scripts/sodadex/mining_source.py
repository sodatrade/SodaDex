"""Pinned FABX source and credential-free Foundry environment for 1952 preparation."""

import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

FABX_SOURCE = "4caabe00d0e4d198aac4576bc0ad27c8cca5ce54"


def require_legacy_rehearsal(root):
    if not (root / "contracts/mining-rehearsal/foundry.toml").is_file():
        raise SystemExit(
            "Retired mining rehearsal: use a separate checkout of "
            "923ecab6a74eed81ed6d8823725df9941c233233 for historical investigation. "
            "Current LP audit: contracts/sodadex-fragments/README.md"
        )


def source_snapshot(root, fabx_source):
    source_root = subprocess.check_output(
        ["git", "-C", str(fabx_source), "rev-parse", "--show-toplevel"], text=True
    ).strip()
    if Path(source_root).resolve() != fabx_source.resolve():
        raise ValueError("Source must be the FABX repository root")
    actual = subprocess.check_output(
        ["git", "-C", source_root, "rev-parse", "HEAD"], text=True
    ).strip()
    if actual != FABX_SOURCE:
        raise ValueError("FABX checkout changed; review and explicitly update the pinned source first")
    snapshot = root / ".analysis/mining-1952/fabx-snapshot"
    stamp = snapshot / ".sodadex-source.json"
    archive = subprocess.check_output(["git", "-C", source_root, "archive", "--format=tar", FABX_SOURCE])
    if snapshot.exists():
        if not stamp.exists() or json.loads(stamp.read_text()).get("commit") != FABX_SOURCE:
            raise ValueError("Existing snapshot is not this script's pinned source; left untouched")
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            for member in source.getmembers():
                if member.isfile():
                    target = snapshot / member.name
                    if target.read_bytes() != source.extractfile(member).read():
                        raise ValueError("Snapshot source changed; files left untouched")
    else:
        snapshot.mkdir(parents=True)
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(snapshot, filter="data")
        stamp.write_text(json.dumps({"commit": FABX_SOURCE, "mode": "committed-source-snapshot"}) + "\n")
    return snapshot.resolve()


def foundry_env(root, snapshot):
    # Wallet variables, RPC endpoints and dotenv files must not enter these subprocesses.
    for folder in (root, root / "contracts/mining-rehearsal"):
        if (folder / ".env").exists():
            raise ValueError("Refusing Foundry preparation in a directory with a dotenv file")
    result = {name: os.environ[name] for name in ("PATH", "HOME", "TMPDIR", "LANG") if name in os.environ}
    snapshot = snapshot.resolve()
    result["FOUNDRY_REMAPPINGS"] = "\n".join([
        f"fabx/={snapshot}/",
        f"forge-std/={snapshot}/lib/forge-std/src/",
        f"@openzeppelin/contracts/={snapshot}/lib/openzeppelin/contracts/",
        f"@openzeppelin/contracts-upgradeable/={snapshot}/lib/openzeppelin/contracts-upgradeable/",
    ])
    result["FOUNDRY_OUT"] = str(root / ".analysis/mining-1952/rehearsal-absolute-out")
    result["FOUNDRY_CACHE_PATH"] = str(root / ".analysis/mining-1952/rehearsal-absolute-cache")
    result["FOUNDRY_BROADCAST"] = str(root / ".analysis/mining-1952/unsigned-dry-run")
    result["FOUNDRY_FFI"] = "false"
    return result

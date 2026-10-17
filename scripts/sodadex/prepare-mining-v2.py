#!/usr/bin/env python3
"""Prepare hash-checked upstream V2 artifacts; never sign, deploy or change an app dependency."""

import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
URL = "https://registry.npmjs.org/@uniswap/v2-periphery/-/v2-periphery-1.1.0-beta.0.tgz"
INTEGRITY = "sha512-6dkwAMKza8nzqYiXEr2D86dgW3TTavUvCR0w2Tu33bAbM8Ah43LKAzH7oKKPRT5VJQaMi1jtkGs1E8JPor1n5g=="


def prepare():
    target = ROOT / ".analysis/mining-1952/v2-artifacts"
    target.mkdir(parents=True, exist_ok=True)
    cached = ROOT / ".analysis/mining-1952/v2-periphery-package/uniswap-v2-periphery-1.1.0-beta.0.tgz"
    if cached.exists():
        payload = cached.read_bytes()
    else:
        with urllib.request.urlopen(URL, timeout=30) as response:
            payload = response.read(20_000_001)
        if len(payload) > 20_000_000:
            raise ValueError("Upstream artifact archive exceeds the bounded download size")
    if "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode() != INTEGRITY:
        raise ValueError("Upstream V2 periphery integrity mismatch")
    manifest = {"localOnly": True, "deploymentReady": False, "sourceUrl": URL,
                "packageIntegrity": INTEGRITY, "artifacts": {}}

    def save(name, source):
        creation = source["bytecode"]
        if not isinstance(creation, str) or not creation or "__" in creation:
            raise ValueError("Missing or unlinked bytecode: " + name)
        creation = creation if creation.startswith("0x") else "0x" + creation
        bytes.fromhex(creation[2:])
        artifact = {"abi": source["abi"], "bytecode": {"object": creation, "linkReferences": {}}}
        data = json.dumps(artifact, sort_keys=True).encode()
        (target / (name + ".json")).write_bytes(data)
        manifest["artifacts"][name] = {"artifactSha256": hashlib.sha256(data).hexdigest(),
                                       "initcodeSha256": hashlib.sha256(bytes.fromhex(creation[2:])).hexdigest()}

    with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
        for name in ("UniswapV2Router02", "WETH9"):
            member = archive.getmember("package/build/" + name + ".json")
            if not member.isfile():
                raise ValueError("Artifact must be a regular file")
            save(name, json.loads(archive.extractfile(member).read()))
        package = json.loads(archive.extractfile("package/package.json").read())
        manifest["license"] = package.get("license")
    core = ROOT / "standalone/web/node_modules/@uniswap/v2-core"
    package = json.loads((core / "package.json").read_text())
    if package["version"] != "1.0.1":
        raise ValueError("Unexpected V2 core package version")
    for name in ("UniswapV2Factory", "UniswapV2Pair"):
        save(name, json.loads((core / "build" / (name + ".json")).read_text()))
    (target / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return target


if __name__ == "__main__":
    print(prepare())

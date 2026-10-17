#!/usr/bin/env python3
"""Read-only deployment prerequisite checks. This program cannot sign or broadcast."""

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

CHAIN_ID = 1952
RPC_URLS = (
    "https://testrpc.xlayer.tech/terigon",
    "https://xlayertestrpc.okx.com/terigon",
)


def rpc_read(url, method, params):
    allowed = {"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_getBalance"}
    if method not in allowed:
        raise ValueError("Only read methods are supported")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != 1:
        raise ValueError("RPC response version or request ID does not match")
    if "error" in result or "result" not in result:
        raise ValueError("RPC returned an error or no result")
    return result["result"]


def address(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        raise ValueError("Invalid public address")
    int(value[2:], 16)
    if int(value[2:], 16) == 0:
        raise ValueError("Zero address is not a deployment")
    return value


def check(manifest, rpc):
    if manifest.get("schemaVersion") != 1 or manifest.get("chainId") != CHAIN_ID:
        raise ValueError("Manifest must explicitly select X Layer testnet 1952")
    roles = manifest.get("dependencies")
    if not isinstance(roles, list) or not roles:
        raise ValueError("An explicit dependency list is required")
    names = [item["role"] for item in roles]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate dependency role")
    # The chain check precedes every balance/code read, including when no addresses are set.
    if int(rpc("eth_chainId", []), 16) != CHAIN_ID:
        raise ValueError("RPC is not X Layer testnet 1952; no code or balance was read")
    block = rpc("eth_blockNumber", [])
    block_info = rpc("eth_getBlockByNumber", [block, False])
    if (not isinstance(block_info, dict) or block_info.get("number") != block
            or not re.fullmatch(r"0x[0-9a-fA-F]{64}", str(block_info.get("hash", "")))):
        raise ValueError("Cannot pin checks to a valid block")
    owner = address(manifest["owner"])
    owner_balance = int(rpc("eth_getBalance", [owner, block]), 16)
    checks = []
    for dependency in roles:
        item = {"role": dependency["role"], "address": dependency.get("address")}
        if item["address"] is None:
            item["status"] = "not-configured"
        else:
            code = rpc("eth_getCode", [address(item["address"]), block])
            if not isinstance(code, str) or not code.startswith("0x"):
                raise ValueError("Malformed contract runtime")
            runtime = bytes.fromhex(code[2:])
            item["runtimeBytes"] = len(runtime)
            item["runtimeSha256"] = hashlib.sha256(runtime).hexdigest()
            expected = dependency.get("expectedRuntimeSha256")
            if not runtime:
                item["status"] = "no-code"
            elif expected is None:
                item["status"] = "runtime-unpinned"
            elif item["runtimeSha256"] != expected:
                item["status"] = "runtime-mismatch"
            elif dependency.get("sourceVerified") is not True:
                item["status"] = "source-verification-pending"
            else:
                item["status"] = "verified-runtime"
        checks.append(item)
    # A reorg during the scan invalidates the whole observation, never a partial success.
    end_block = rpc("eth_getBlockByNumber", [block, False])
    if (not isinstance(end_block, dict) or end_block.get("number") != block
            or end_block.get("hash") != block_info["hash"]):
        raise ValueError("Pinned block changed during checks")
    ready = owner_balance > 0 and all(item["status"] == "verified-runtime" for item in checks)
    return {
        "schemaVersion": 1,
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "chainId": CHAIN_ID,
        "blockNumber": int(block, 16),
        "blockHash": block_info["hash"],
        "owner": owner,
        "ownerBalanceWei": str(owner_balance),
        "dependencies": checks,
        "configuredDependenciesReady": ready,
        "broadcastPerformed": False,
        "scope": "Only declared entries and owner funding; sourceVerified records a prior review, not compilation by this script; not full dependency or business acceptance",
    }


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=root / "deployments/xlayer-1952/dependencies.json")
    parser.add_argument("--rpc", choices=RPC_URLS, default=RPC_URLS[0])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = check(json.loads(args.manifest.read_text()), lambda method, params: rpc_read(args.rpc, method, params))
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        # Preserve earlier observations rather than silently replacing evidence.
        with args.output.open("x") as target:
            target.write(rendered)
    print(rendered, end="")
    return 0 if result["configuredDependenciesReady"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

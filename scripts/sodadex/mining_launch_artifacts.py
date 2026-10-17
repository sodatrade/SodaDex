"""Explicit offline artifacts for the real Manager integration lane (never broadcast)."""

import json
import re

CANONICAL_LAUNCH = (
    "CurveTrading", "LaunchLogic", "V2Graduation", "IgnixManager", "IgnixLaunchFactory",
    "VaultRegistry", "IgnixLpLocker", "IgnixV2Locker", "IgnixLiquidityHelper",
    "IgnixV4Router", "IgnixPoolGuard",
)


def launch_artifacts(root, compiled):
    result = {}
    for name in CANONICAL_LAUNCH:
        path = compiled / (name + ".sol") / (name + ".json")
        data = json.loads(path.read_text())
        refs = data["bytecode"]["linkReferences"]
        if refs and name != "IgnixManager":
            raise ValueError("Unexpected linked launch artifact: " + name)
        if name == "IgnixManager":
            offsets = {}
            code = data["bytecode"]["object"].removeprefix("0x")
            occupied = set()
            for contracts in refs.values():
                for library, entries in contracts.items():
                    if library not in {"CurveTrading", "LaunchLogic", "V2Graduation"}:
                        raise ValueError("Unknown Manager library: " + library)
                    for item in entries:
                        if item["length"] != 20:
                            raise ValueError("Unexpected Manager link width")
                        start = item["start"]
                        if start < 0 or (start + 20) * 2 > len(code) or any(i in occupied for i in range(start, start + 20)):
                            raise ValueError("Invalid or overlapping Manager link offset")
                        if re.fullmatch(r"__\$[0-9a-f]{34}\$__", code[start * 2:(start + 20) * 2]) is None:
                            raise ValueError("Manager link does not identify an unlinked library slot")
                        occupied.update(range(start, start + 20))
                        code = code[:start * 2] + "00" * 20 + code[(start + 20) * 2:]
                        offsets.setdefault(library, []).append(start)
            if set(offsets) != {"CurveTrading", "LaunchLogic", "V2Graduation"}:
                raise ValueError("Missing explicit Manager libraries")
            bytes.fromhex(code)
            data["bytecode"]["object"] = "0x" + code
            data["sodadexLibraries"] = offsets
        result[name] = json.dumps(data, sort_keys=True).encode()
    external = {
        "PoolManager": ".analysis/upstream/universal-router-2.1.2/lib/v4-periphery/lib/v4-core/out/PoolManager.sol/PoolManager.json",
        "Permit2": ".analysis/upstream/permit2/out/Permit2.sol/Permit2.json",
        "PositionDescriptor": ".analysis/branding-repro/v4/foundry-out/PositionDescriptor.sol/PositionDescriptor.json",
        "PositionManager": ".analysis/branding-repro/v4/foundry-out/PositionManager.sol/PositionManager.json",
        "V4Quoter": ".analysis/upstream/universal-router-2.1.2/lib/v4-periphery/foundry-out/V4Quoter.sol/V4Quoter.json",
    }
    for name, relative in external.items():
        data = json.loads((root / relative).read_text())
        if data["bytecode"]["linkReferences"] or not data["bytecode"]["object"]:
            raise ValueError("External dependency is not a complete unlinked creation artifact: " + name)
        result[name] = json.dumps(data, sort_keys=True).encode()
    return result

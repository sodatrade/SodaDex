#!/usr/bin/env python3
"""Build separate compiler artifacts and test actual FABX/product integration locally."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

from fee_policy import PROFILES, require_test_profile
from mining_history_source import history_source_snapshot
from mining_source import foundry_env
from mining_launch_artifacts import CANONICAL_LAUNCH, launch_artifacts


def prepared_artifacts(directory, full_launch, with_v2):
    """Read an existing, explicit creation-artifact snapshot without rebuilding another checkout."""
    names = ["FabFragmentVault", "FabFragmentPool", "FabMinerTestBuyer"]
    if with_v2:
        names += ["FabMiningFarm", "MiningProjectFactory", "MiningProjectVault", "MiningHolderRewards", "IgnixToken"]
    if full_launch:
        names += list(CANONICAL_LAUNCH) + ["PoolManager", "Permit2", "PositionDescriptor", "PositionManager", "V4Quoter"]
    result = {}
    for name in names:
        data = (directory / (name + ".sol") / (name + ".json")).read_bytes()
        artifact = json.loads(data)
        code = artifact["bytecode"]["object"].removeprefix("0x")
        if not code or not bytes.fromhex(code):
            raise ValueError("Missing complete prepared creation bytecode: " + name)
        if name == "IgnixManager":
            links = artifact.get("sodadexLibraries", {})
            if set(links) != {"CurveTrading", "LaunchLogic", "V2Graduation"}:
                raise ValueError("Prepared Manager requires explicit reviewed library offsets")
            occupied = set()
            for entries in links.values():
                for offset in entries:
                    if (not isinstance(offset, int) or offset < 0 or (offset + 20) * 2 > len(code)
                            or code[offset * 2:(offset + 20) * 2] != "00" * 20
                            or any(i in occupied for i in range(offset, offset + 20))):
                        raise ValueError("Invalid prepared Manager library slot")
                    occupied.update(range(offset, offset + 20))
        elif artifact["bytecode"]["linkReferences"]:
            raise ValueError("Prepared artifact has unresolved libraries: " + name)
        result[name] = data
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fabx-source", type=Path, required=True)
    parser.add_argument("--ignix-contracts", type=Path, help="Credential-free canonical source checkout to compile")
    parser.add_argument("--prepared-artifacts", type=Path, help="Reuse an explicit existing complete artifact snapshot read-only")
    parser.add_argument("--v2-artifacts", type=Path, help="Include real Router02/Market/Farm/Token integration")
    parser.add_argument("--full-launch", action="store_true", help="Also run real Manager curve and graduation")
    browser = parser.add_mutually_exclusive_group()
    browser.add_argument("--browser-fixture", action="store_true", help="Export the original loopback Anvil fixture, without broadcasting")
    browser.add_argument("--browser-online-fixture", action="store_true", help="Export a separate contemporary online-signing loopback fixture")
    parser.add_argument("--fixture-timestamp", type=int, help="Explicit Unix-second clock for the online fixture; defaults to current time")
    args = parser.parse_args()
    if (args.browser_fixture or args.browser_online_fixture) and not args.full_launch:
        raise ValueError("Browser fixture requires the full real launch stack")
    if args.fixture_timestamp is not None and (not args.browser_online_fixture or args.fixture_timestamp <= 88_401):
        raise ValueError("An explicit contemporary clock is only supported for the online fixture")
    if bool(args.prepared_artifacts) == bool(args.ignix_contracts):
        raise ValueError("Choose exactly one of --prepared-artifacts or --ignix-contracts")
    if args.full_launch and not args.v2_artifacts:
        raise ValueError("Full launch requires the verified local V2 artifacts")
    root = Path(__file__).resolve().parents[2]
    require_test_profile(PROFILES["test"])
    baseline, variant = history_source_snapshot(root, args.fabx_source)
    hashes = {}
    if args.prepared_artifacts:
        artifact_data = prepared_artifacts(args.prepared_artifacts.resolve(strict=True), args.full_launch, bool(args.v2_artifacts))
    else:
        contracts = args.ignix_contracts.resolve(strict=True)
        if (contracts / ".env").exists():
            raise ValueError("Refusing artifact preparation in a contract root with a dotenv file")
        artifacts = root / ".analysis/mining-1952/ignix-product-out"
        build_env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG") if key in os.environ}
        build_command = [
            "forge", "build", "src/mining/FabFragmentVault.sol", "src/mining/FabFragmentPool.sol", "src/mining/FabMinerTestBuyer.sol",
            "src/mining/FabMiningFarm.sol", "src/mining/MiningProjectFactory.sol", "src/launch/IgnixToken.sol",
            "--out", str(artifacts), "--cache-path", str(root / ".analysis/mining-1952/ignix-product-cache"),
        ]
        if args.full_launch:
            build_command += ["src/launch/IgnixManager.sol", "src/launch/IgnixLaunchFactory.sol", "src/vault/VaultRegistry.sol",
                              "src/launch/IgnixLpLocker.sol", "src/launch/IgnixV2Locker.sol", "src/launch/IgnixLiquidityHelper.sol",
                              "src/launch/IgnixV4Router.sol", "src/launch/IgnixPoolGuard.sol"]
        subprocess.run(build_command, cwd=contracts, env=build_env, check=True)
        names = ["FabFragmentVault", "FabFragmentPool", "FabMinerTestBuyer"]
        if args.v2_artifacts:
            names += ["FabMiningFarm", "MiningProjectFactory", "MiningProjectVault", "MiningHolderRewards", "IgnixToken"]
        artifact_data = {name: (artifacts / (name + ".sol") / (name + ".json")).read_bytes() for name in names}
        for name, data in artifact_data.items():
            if json.loads(data)["bytecode"]["linkReferences"]:
                raise ValueError("Product artifact requires explicit library linking: " + name)
        if args.full_launch:
            artifact_data.update(launch_artifacts(root, artifacts))
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in artifact_data.items()}
    snapshot_id = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    snapshot = root / ".analysis/mining-1952/product-artifacts" / snapshot_id
    for name, data in artifact_data.items():
        path = snapshot / (name + ".sol") / (name + ".json")
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.read_bytes() != data:
            raise ValueError("An immutable product artifact snapshot was changed")
        path.write_bytes(data)
    artifacts = snapshot
    env = foundry_env(root, variant)
    env["FOUNDRY_REMAPPINGS"] += "\nfabx-baseline/=" + str(baseline) + "/"
    env["FOUNDRY_OUT"] = str(root / ".analysis/mining-1952/rewards-out")
    env["FOUNDRY_CACHE_PATH"] = str(root / ".analysis/mining-1952/rewards-cache")
    env["FOUNDRY_SRC"] = str(root / "contracts/mining-rehearsal/test")
    env["FOUNDRY_TEST"] = str(root / "contracts/mining-rehearsal/test")
    env["SODADEX_MINING_ARTIFACT_ROOT"] = str(artifacts)
    permissions = [{"access": "read", "path": str(artifacts)}]
    if args.browser_fixture or args.browser_online_fixture:
        browser_output = root / ".analysis/mining-1952" / ("browser-online-fixture" if args.browser_online_fixture else "browser-fixture")
        browser_output.mkdir(parents=True, exist_ok=True)
        env["SODADEX_MINING_BROWSER_OUTPUT"] = str(browser_output)
        permissions.append({"access": "read-write", "path": str(browser_output)})
        if args.browser_online_fixture:
            env["SODADEX_MINING_BROWSER_NOW"] = str(args.fixture_timestamp or int(time.time()))
    fixtures = variant / "test/fixtures/fork"
    env["SODADEX_FABX_FIXTURES"] = str(fixtures)
    permissions.append({"access": "read", "path": str(fixtures)})
    if args.v2_artifacts:
        v2_artifacts = args.v2_artifacts.resolve(strict=True)
        env["SODADEX_V2_ARTIFACT_ROOT"] = str(v2_artifacts)
        permissions.append({"access": "read", "path": str(v2_artifacts)})
    # Foundry does not merge fs_permissions from this environment variable.
    # Give this local test profile read access to the exact artifact directory only.
    config = root / ".analysis/mining-1952/products-config/foundry.toml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text((root / "contracts/mining-rehearsal/foundry.toml").read_text()
                      + '\nfs_permissions = [' + ', '.join('{ access = ' + json.dumps(item['access']) + ', path = '
                      + json.dumps(item['path']) + ' }' for item in permissions) + ']\n')
    print(json.dumps({"localOnly": True, "broadcast": False, "productArtifactsSha256": hashes}), flush=True)
    selected = "FabFragmentRealIntegrationTest|FabMiningRealIntegrationTest" if args.v2_artifacts else "FabFragmentRealIntegrationTest"
    if args.full_launch:
        selected += "|FabMiningFullLaunchTest"
    command = [
        "forge", "test", "--root", str(root / "contracts/mining-rehearsal"),
        "--config-path", str(config),
        "--match-contract", selected,
    ]
    export_test = "test_exportOnlineBrowserFixture" if args.browser_online_fixture else "test_exportBrowserFixture"
    command += ["--match-test", export_test] if args.browser_fixture or args.browser_online_fixture else ["--no-match-test", "test_export(Browser|OnlineBrowser)Fixture"]
    discovery = subprocess.run(command + ["--list", "--json"], cwd=root, env=env,
                               capture_output=True, text=True, check=False)
    if discovery.returncode != 0:
        print(discovery.stdout, end="", flush=True)
        print(discovery.stderr, end="", flush=True)
        return discovery.returncode
    tests = json.loads(discovery.stdout)
    required = ("test_realSourcePaysOldHolderBeforeShareTransferAndAllowsNftRedemption",
                "test_realSourceBackedPoolRunsBothDirectionsAndLiquidityExit",
                "test_permissionlessRealPromotionKeepsCustodiedBackingAndRedemption",
                "test_fullCapacityRealSourceGasAndExit",
                "test_realSourcePauseBlocksSwapButPreservesBookedVaultAndLpClaims",
                "test_realChallengeInvalidatesAllBackingButKeepsHistoricalClaims",
                "test_realPartialChallengeSharesLossWithoutChangingIndividualBalances")
    if args.v2_artifacts:
        required += ("test_realMarketAndNativeRouterPurchasePreservesPrincipalAndSellerOutput",
                     "test_realTokenTransferKeepsOldMiningRewardsAndFutureIncomeGoesToNewHolder",
                     "test_realSourceZeroHolderIncomeStaysParkedAfterFirstBuyer",
                     "test_realTokenV2SellCollectsProjectTaxWithoutCreditingPoolAsHolder",
                     "test_realSourceBurnExpiryUsesHistoricalIncomeAndCapClipping",
                     "test_realSourceExhaustedCapDoesNotBlockExpiryTransferOrOldClaim",
                     "test_realSourcePauseBlocksProjectTransferButKeepsBookedClaim")
    if args.full_launch:
        required += ("test_realSignedLaunchFundsMinerBeforeGraduationThenTradesGraduatedV2",)
    if args.browser_fixture or args.browser_online_fixture:
        required = (export_test,)
    if not all(name in json.dumps(tests) for name in required):
        raise ValueError("Mandatory real-source product tests were not discovered")
    result = subprocess.run(command + ["-vv"], cwd=root, env=env, capture_output=True, text=True, check=False)
    print(result.stdout, end="", flush=True)
    print(result.stderr, end="", flush=True)
    if result.returncode != 0:
        return result.returncode
    if any(("[PASS] " + name + "()") not in result.stdout for name in required):
        raise ValueError("A mandatory real-source test did not pass; missing/skipped tests are not acceptance")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Fee parameter checks only. This module cannot approve, sign or deploy contracts."""

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TEST_OWNER = "0x6ecf746b078d46391f8C425B150153212F7C0545"
PROFILES = {stage: ROOT / "deployments/fees" / filename for stage, filename in
            (("test", "test-1952.json"), ("production", "production-pending.json"))}

# These checks describe the pinned implementations, not permission to change them.
# Unimplemented output fees have only the mathematical BPS bound here; product must
# separately define operational caps and the implementation must enforce them.
FEE_FIELDS = {
    "setup": {
        "cpuCreationWei": ("wei", 0, None),
        "transistorUnitPriceWei": ("wei", 0, None),
        "transistorMintProtocolWei": ("wei", 0, None),
        "tapeoutWei": ("wei", 0, None),
        "nftMarketBps": ("int", 0, 300),
    },
    "mining": {
        "listingFeeRaw": ("uint", 0, None),
        "snipeStartBps": ("snipe", 0, 9_000),
        "snipeMins": ("int", 0, 65_535),
        "v2ProtocolEnabled": ("int", 0, 1),
        "curveBuyPlatformBps": ("fixed", 100, 100),
        "curveSellPlatformBps": ("fixed", 100, 100),
        "graduationLpPlatformShareBps": ("fixed", 5_000, 5_000),
        "buyTaxBps": ("int", 100, 1_000),
        "sellTaxBps": ("int", 100, 1_000),
        "protocolShareOfTaxBps": ("int", 100, 1_000),
        "creatorShareOfNetTaxBps": ("int", 0, 5_000),
        "outputPlatformBps": ("int", 0, 10_000),
        "v2LpBps": ("fixed", 30, 30),
    },
    "fragmentation": {
        "tradeBps": ("fixed", 50, 50),
        "platformShareOfFeeBps": ("fixed", 3_000, 3_000),
        "outputServiceBps": ("int", 0, 10_000),
        "depositBps": ("fixed", 0, 0),
        "redeemBps": ("fixed", 0, 0),
    },
    "dex": {
        "v3LpPips": ("int", 0, 999_999),
        "v3ProtocolDenominator": ("denominator", 0, 10),
        "v4LpPips": ("int", 0, 1_000_000),
        "v4ProtocolPips": ("int", 0, 1_000),
        "interfaceBps": ("fixed", 0, 0),
        "limitOrderCommissionBps": ("fixed", 0, 0),
    },
}
RECIPIENTS = ("factoryProtocol", "transistorCreator", "tapeoutTreasury", "marketProtocol",
              "miningCurvePlatform", "lockedLpPlatform", "lockedLpCreator", "v2Protocol",
              "miningTaxPlatform", "miningOutputPlatform", "miningCreator",
              "fragmentTradePlatform", "fragmentServicePlatform", "v3Protocol", "v4Protocol", "feeAdmin")
OPERATIONS = ("distributionGas", "limitOrderGas", "feeChanges")
TEST_OPERATIONS = {"distributionGas": "sponsored-by-test-operator", "limitOrderGas": "sponsored-by-test-keeper",
                   "feeChanges": "test-only; production requires separate product decision"}
APPROVAL_FIELDS = {"state", "approvedBy", "decisionReference", "configurationSha256"}
PROFILE_FIELDS = {"schemaVersion", "stage", "chainId", "fees", "recipients", "assetAllocation", "launchRules", "operations", "approval"}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate fee profile key: " + key)
        result[key] = value
    return result


def read_profile(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=_unique_object)


def configuration_sha256(profile):
    """Bind product's decision to every parameter, recipient and operating rule."""
    values = {key: value for key, value in profile.items() if key != "approval"}
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def _keys(value, expected, label, errors):
    if not isinstance(value, dict) or set(value) != set(expected):
        errors.append(label + ": missing or unknown fields")
        return False
    return True


def _address(value):
    return isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", value) is not None and int(value[2:], 16) != 0


def inspect_profile(profile, stage):
    if stage not in PROFILES:
        raise ValueError("Unknown fee profile stage")
    errors, pending = [], []
    if not _keys(profile, PROFILE_FIELDS, "profile", errors):
        return {"valid": False, "errors": errors, "pendingProductDecisions": [], "scope": "Fee parameters only"}
    if type(profile["schemaVersion"]) is not int or profile["schemaVersion"] != 1:
        errors.append("Unsupported fee profile schema")
    expected_chain = 1952 if stage == "test" else 196
    if profile["stage"] != stage or type(profile["chainId"]) is not int or profile["chainId"] != expected_chain:
        errors.append("Fee stage/chain mismatch; test and production cannot substitute for each other")

    def required(value, label):
        if value is None:
            (pending if stage == "production" else errors).append(label)
            return False
        return True

    if _keys(profile["fees"], FEE_FIELDS, "fees", errors):
        for group, fields in FEE_FIELDS.items():
            if not _keys(profile["fees"][group], fields, "fees." + group, errors):
                continue
            for name, (kind, minimum, maximum) in fields.items():
                value, label = profile["fees"][group][name], "fees." + group + "." + name
                if not required(value, label):
                    continue
                if kind in ("wei", "uint"):
                    valid = isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]*", value) is not None
                    number = int(value) if valid else -1
                    valid = valid and number < 2**256
                else:
                    valid = type(value) is int
                    number = value if valid else -1
                valid = valid and minimum <= number and (maximum is None or number <= maximum)
                if kind == "denominator":
                    valid = valid and number in (0, 4, 5, 6, 7, 8, 9, 10)
                if kind == "snipe":
                    valid = valid and (number == 0 or number >= 2_000)
                if not valid:
                    errors.append(label + ": outside current implementation bounds; code changes require separate validation")
                elif stage == "test" and number != minimum:
                    errors.append(label + ": test profile must use the lowest supported value")

    fee_groups = profile["fees"] if isinstance(profile["fees"], dict) else {}
    mining = fee_groups.get("mining")
    if _keys(profile["recipients"], RECIPIENTS, "recipients", errors):
        for name, value in profile["recipients"].items():
            label = "recipients." + name
            if not required(value, label):
                continue
            if name == "v2Protocol":
                enabled = mining.get("v2ProtocolEnabled") if isinstance(mining, dict) else None
                if value == "0x" + "00" * 20 and enabled == 0:
                    continue
                if not _address(value) or stage == "test":
                    errors.append(label + ": disabled test protocol must use zero feeTo; enabled production needs a recipient")
                continue
            if not _address(value) or (stage == "test" and value.lower() != TEST_OWNER.lower()):
                errors.append(label + ": invalid or unexpected test recipient")

    if isinstance(mining, dict):
        start, minutes = mining.get("snipeStartBps"), mining.get("snipeMins")
        if type(start) is int and start > 0:
            if type(minutes) is not int or minutes < 1:
                errors.append("Enabled anti-snipe fee requires at least one minute")
            combined = [start, mining.get("curveBuyPlatformBps"), mining.get("buyTaxBps")]
            if all(type(value) is int for value in combined) and sum(combined) > 9_500:
                errors.append("Combined curve, project and anti-snipe buy fees exceed source bound")

    if _keys(profile["launchRules"], ("graduationProtectionSeconds",), "launchRules", errors):
        value = profile["launchRules"]["graduationProtectionSeconds"]
        if required(value, "launchRules.graduationProtectionSeconds"):
            if type(value) is not int or value < 86_400 or value >= 2**64 or (stage == "test" and value != 86_400):
                errors.append("V2 graduation protection is at least 86400 seconds; test uses the source minimum")

    if _keys(profile["assetAllocation"], ("fabPremineBps", "fabPremineRecipient"), "assetAllocation", errors):
        allocation = profile["assetAllocation"]
        if required(allocation["fabPremineBps"], "assetAllocation.fabPremineBps"):
            if type(allocation["fabPremineBps"]) is not int or allocation["fabPremineBps"] != 500:
                errors.append("FAB premine is fixed at 5% by pinned source; it is not a fee")
        value = allocation["fabPremineRecipient"]
        if required(value, "assetAllocation.fabPremineRecipient"):
            if not _address(value) or (stage == "test" and value.lower() != TEST_OWNER.lower()):
                errors.append("Invalid FAB premine recipient")

    if _keys(profile["operations"], OPERATIONS, "operations", errors):
        for name, value in profile["operations"].items():
            if required(value, "operations." + name) and (not isinstance(value, str) or not value.strip()):
                errors.append("operations." + name + ": explicit product rule required")
        if stage == "test" and profile["operations"] != TEST_OPERATIONS:
            errors.append("Test automatic execution must use sponsored gas and no production fee policy")

    if _keys(profile["approval"], APPROVAL_FIELDS, "approval", errors):
        approval = profile["approval"]
        if stage == "test":
            if approval != {"state": "test-only", "approvedBy": None, "decisionReference": None, "configurationSha256": None}:
                errors.append("Test profile cannot carry production approval")
        else:
            if approval["state"] != "product-approved":
                pending.append("approval.state: product decision not recorded")
            for name in ("approvedBy", "decisionReference", "configurationSha256"):
                if not isinstance(approval[name], str) or not approval[name].strip():
                    pending.append("approval." + name)
            if approval["configurationSha256"] and approval["configurationSha256"] != configuration_sha256(profile):
                errors.append("Product approval digest does not match the current fee configuration")

    return {"valid": not errors and not pending, "stage": stage, "chainId": expected_chain,
            "configurationSha256": configuration_sha256(profile), "errors": errors,
            "pendingProductDecisions": pending,
            "scope": "Fee parameters only; not proof of implementation, deployment readiness or human authorization"}


def require_test_profile(path):
    profile = read_profile(path)
    result = inspect_profile(profile, "test")
    if not result["valid"]:
        raise ValueError("Invalid 1952 test fee profile: " + "; ".join(result["errors"]))
    return result

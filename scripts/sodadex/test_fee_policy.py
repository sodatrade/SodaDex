import copy
from pathlib import Path
import tempfile
import unittest

from fee_policy import PROFILES, configuration_sha256, inspect_profile, read_profile, require_test_profile


class FeePolicyTest(unittest.TestCase):
    def setUp(self):
        self.test = read_profile(PROFILES["test"])
        self.production = read_profile(PROFILES["production"])

    def approved_fixture(self):
        profile = copy.deepcopy(self.test)
        profile.update(stage="production", chainId=196)
        profile["operations"] = {key: "Product fixture decision" for key in profile["operations"]}
        profile["approval"] = {"state": "product-approved", "approvedBy": "Product fixture",
                               "decisionReference": "Offline fixture only", "configurationSha256": configuration_sha256(profile)}
        return profile

    def test_minimum_1952_profile_passes_without_production_approval(self):
        self.assertTrue(require_test_profile(PROFILES["test"])["valid"])

    def test_production_template_contains_no_test_defaults(self):
        self.assertTrue(all(v is None for fields in self.production["fees"].values() for v in fields.values()))
        self.assertTrue(all(v is None for v in self.production["recipients"].values()))
        result = inspect_profile(self.production, "production")
        self.assertFalse(result["valid"])
        self.assertIn("fees.mining.outputPlatformBps", result["pendingProductDecisions"])
        self.assertIn("recipients.tapeoutTreasury", result["pendingProductDecisions"])

    def test_stage_and_chain_cannot_substitute_for_each_other(self):
        self.assertFalse(inspect_profile(self.test, "production")["valid"])
        self.assertFalse(inspect_profile(self.production, "test")["valid"])
        self.test["chainId"] = 196
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_mainnet_number_without_explicit_product_approval_is_blocked(self):
        self.test.update(stage="production", chainId=196)
        self.assertFalse(inspect_profile(self.test, "production")["valid"])

    def test_non_minimum_test_setup_fee_rejected(self):
        self.test["fees"]["setup"]["tapeoutWei"] = "1300000000000000"
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_minimum_tax_is_not_silently_changed_to_zero(self):
        for name in ("buyTaxBps", "sellTaxBps", "protocolShareOfTaxBps"):
            with self.subTest(name=name):
                profile = copy.deepcopy(self.test)
                profile["fees"]["mining"][name] = 0
                self.assertFalse(inspect_profile(profile, "test")["valid"])

    def test_fixed_fragment_fee_and_v2_fee_cannot_be_erased(self):
        for group, field in (("fragmentation", "tradeBps"), ("fragmentation", "platformShareOfFeeBps"), ("mining", "v2LpBps"),
                             ("mining", "curveBuyPlatformBps"), ("mining", "curveSellPlatformBps"),
                             ("mining", "graduationLpPlatformShareBps")):
            with self.subTest(field=field):
                profile = copy.deepcopy(self.test)
                profile["fees"][group][field] = 0
                self.assertFalse(inspect_profile(profile, "test")["valid"])

    def test_wei_values_cannot_use_float_or_scientific_notation(self):
        for value in (0, 0.0, "0.0013", "1e3", "-1", str(2**256)):
            with self.subTest(value=value):
                self.test["fees"]["setup"]["cpuCreationWei"] = value
                self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_boolean_cannot_be_used_as_fee_or_chain_id(self):
        self.test["fees"]["dex"]["interfaceBps"] = False
        self.assertFalse(inspect_profile(self.test, "test")["valid"])
        self.production["chainId"] = True
        self.assertFalse(inspect_profile(self.production, "production")["valid"])

    def test_unknown_or_missing_parameters_fail_closed(self):
        self.test["fees"]["setup"]["hiddenPlatformBps"] = 50
        self.assertFalse(inspect_profile(self.test, "test")["valid"])
        del self.test["fees"]["setup"]["hiddenPlatformBps"]
        del self.test["fees"]["setup"]["cpuCreationWei"]
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_unknown_json_keys_are_not_last_write_wins(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "profile.json"
            path.write_text('{"stage":"test","stage":"production"}')
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                read_profile(path)

    def test_test_recipients_are_explicit_and_nonzero(self):
        self.test["recipients"]["miningTaxPlatform"] = "0x" + "00" * 20
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_automatic_test_gas_cannot_be_charged_by_text_change(self):
        self.test["operations"]["distributionGas"] = "charge holders"
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_premine_is_separate_from_fees_and_matches_source(self):
        self.test["assetAllocation"]["fabPremineBps"] = 0
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_complete_product_fixture_validates_parameters_only(self):
        result = inspect_profile(self.approved_fixture(), "production")
        self.assertTrue(result["valid"])
        self.assertIn("not proof of implementation", result["scope"])

    def test_changing_fee_recipient_or_operating_rules_invalidates_approval(self):
        for kind in ("fee", "recipient", "operation"):
            with self.subTest(kind=kind):
                profile = self.approved_fixture()
                if kind == "fee":
                    profile["fees"]["mining"]["outputPlatformBps"] = 500
                elif kind == "recipient":
                    profile["recipients"]["miningTaxPlatform"] = "0x" + "11" * 20
                else:
                    profile["operations"]["distributionGas"] = "new product rule"
                result = inspect_profile(profile, "production")
                self.assertFalse(result["valid"])
                self.assertTrue(any("digest" in error for error in result["errors"]))

    def test_product_can_decide_different_receivers_for_separate_income_streams(self):
        profile = self.approved_fixture()
        for index, name in enumerate(("miningTaxPlatform", "miningOutputPlatform", "fragmentTradePlatform",
                                      "fragmentServicePlatform", "v3Protocol", "v4Protocol"), start=1):
            profile["recipients"][name] = "0x" + format(index, "040x")
        profile["approval"]["configurationSha256"] = configuration_sha256(profile)
        self.assertTrue(inspect_profile(profile, "production")["valid"])

    def test_legacy_shared_recipient_cannot_omit_the_separate_decisions(self):
        profile = self.approved_fixture()
        profile["recipients"]["miningPlatform"] = profile["recipients"].pop("miningOutputPlatform")
        profile["approval"]["configurationSha256"] = configuration_sha256(profile)
        self.assertFalse(inspect_profile(profile, "production")["valid"])

    def test_production_cannot_change_compile_time_fee_with_only_json(self):
        profile = self.approved_fixture()
        profile["fees"]["dex"]["limitOrderCommissionBps"] = 10
        profile["approval"]["configurationSha256"] = configuration_sha256(profile)
        self.assertFalse(inspect_profile(profile, "production")["valid"])

    def test_v3_protocol_fraction_is_not_a_generic_bps(self):
        profile = self.approved_fixture()
        profile["fees"]["dex"]["v3ProtocolDenominator"] = 100
        profile["approval"]["configurationSha256"] = configuration_sha256(profile)
        self.assertFalse(inspect_profile(profile, "production")["valid"])

    def test_minimum_launch_disables_extra_fees_but_keeps_one_day_protection(self):
        self.assertEqual(self.test["fees"]["mining"]["listingFeeRaw"], "0")
        self.assertEqual(self.test["fees"]["mining"]["snipeStartBps"], 0)
        self.assertEqual(self.test["recipients"]["v2Protocol"], "0x" + "00" * 20)
        self.test["launchRules"]["graduationProtectionSeconds"] = 0
        self.assertFalse(inspect_profile(self.test, "test")["valid"])

    def test_enabled_anti_snipe_obeys_source_range_duration_and_total_bound(self):
        for start, minutes, tax in ((100, 1, 100), (2_000, 0, 100), (9_000, 1, 1_000)):
            with self.subTest(start=start, minutes=minutes, tax=tax):
                p = self.approved_fixture()
                p["fees"]["mining"].update(snipeStartBps=start, snipeMins=minutes, buyTaxBps=tax)
                p["approval"]["configurationSha256"] = configuration_sha256(p)
                self.assertFalse(inspect_profile(p, "production")["valid"])

    def test_v2_protocol_requires_explicit_nonzero_production_recipient_when_enabled(self):
        p = self.approved_fixture()
        p["fees"]["mining"]["v2ProtocolEnabled"] = 1
        p["approval"]["configurationSha256"] = configuration_sha256(p)
        self.assertFalse(inspect_profile(p, "production")["valid"])
        p["recipients"]["v2Protocol"] = "0x" + "11" * 20
        p["approval"]["configurationSha256"] = configuration_sha256(p)
        self.assertTrue(inspect_profile(p, "production")["valid"])


if __name__ == "__main__":
    unittest.main()

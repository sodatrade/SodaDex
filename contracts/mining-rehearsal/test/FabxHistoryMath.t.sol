// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DewebRewardAccounting as Source} from "fabx/src/pod/lib/DewebRewardAccounting.sol";
import {FabxHistoryMath as History} from "../src/FabxHistoryMath.sol";

contract FabxHistoryMathTest is Test {
    function testFuzz_emissionMatchesPinnedSourceAcrossHalvings(uint64 from, uint64 elapsed) public pure {
        uint256 start = 1_000;
        assertEq(History.emission(start, from, uint256(from) + elapsed), Source.emission(start, from, uint256(from) + elapsed));
    }

    function testFuzz_intervalEndpointMatchesActualSourcePreview(
        uint32 elapsed, uint64 verified, uint64 unverified, uint64 extra, uint16 cutoff
    ) public {
        uint64 start = 100;
        uint64 from = uint64(start + 126_000_000 - 100);
        uint64 to = uint64(uint256(from) + bound(elapsed, 1, 3 days));
        vm.warp(to);
        uint256[2] memory baseline = [bound(verified, 0, 1e20), bound(unverified, 0, 1e20)];
        uint256[2] memory raw = [bound(extra, 0, 1e20), bound(extra / 2, 0, 1e20)];
        uint64 until = cutoff == 0 ? 0 : uint64(uint256(from) + uint256(cutoff) % (to - from + 1));
        bytes32 slot = keccak256("fab.pod.deweb.reward.accounting.v1");
        // Populate only the source's published namespaced extra fields for this characterization.
        vm.store(address(this), bytes32(uint256(slot) + 1), bytes32(uint256(until)));
        vm.store(address(this), bytes32(uint256(slot) + 2), bytes32(raw[0]));
        vm.store(address(this), bytes32(uint256(slot) + 3), bytes32(raw[1]));
        vm.store(address(this), bytes32(uint256(slot) + 4), bytes32(uint256(11)));
        vm.store(address(this), bytes32(uint256(slot) + 5), bytes32(uint256(22)));
        (uint256[2] memory expectedBase, uint256[2] memory expectedExtra,) = Source.preview(start, from, baseline);
        History.Interval memory r = History.Interval(start, from, to, until, baseline, raw,
            [uint256(33), uint256(44)], [uint256(11), uint256(22)]);
        (uint256[2] memory base, uint256[2] memory extras) = History.accumulatorsAt(r, to);
        assertEq(base[0], expectedBase[0] + 33);
        assertEq(base[1], expectedBase[1] + 44);
        assertEq(extras[0], expectedExtra[0]);
        assertEq(extras[1], expectedExtra[1]);
        (base, extras) = History.accumulatorsAt(r, from);
        assertEq(base[0], 33); assertEq(base[1], 44);
        assertEq(extras[0], 11); assertEq(extras[1], 22);
    }

    function test_prefixUsesHistoricalPoolWeightsInsteadOfElapsedSeconds() public pure {
        History.Interval memory early = History.Interval(100, 100, 200, 0,
            [uint256(600), uint256(0)], [uint256(0), uint256(0)], [uint256(0), uint256(0)], [uint256(0), uint256(0)]);
        (uint256[2] memory end,) = History.accumulatorsAt(early, 200);
        History.Interval memory late = History.Interval(100, 200, 300, 0,
            [uint256(1200), uint256(0)], [uint256(0), uint256(0)], end, [uint256(0), uint256(0)]);
        (uint256[2] memory finalEnd,) = History.accumulatorsAt(late, 300);
        assertGt(end[0], finalEnd[0] - end[0]);
    }

    function testFuzz_paidCutsAlwaysSumExactlyToActualMint(uint256 gross, uint256 actual, uint256 cutA, uint256 cutB) public pure {
        gross = bound(gross, 1, type(uint256).max);
        actual = bound(actual, 0, gross);
        cutA = bound(cutA, 0, gross);
        cutB = bound(cutB, cutA, gross);
        uint256 a = History.paidPrefix(actual, gross, cutA);
        uint256 b = History.paidPrefix(actual, gross, cutB);
        uint256 end = History.paidPrefix(actual, gross, gross);
        assertLe(a, b); assertLe(b, end);
        assertEq(a + (b - a) + (end - b), actual);
    }

    function test_zeroPaidAndSubunitCutsDoNotReviveClippedIncome() public pure {
        assertEq(History.paidPrefix(0, 100, 99), 0);
        assertEq(History.paidPrefix(1, 100, 99), 0);
        assertEq(History.paidPrefix(1, 100, 100), 1);
        assertEq(History.paidPrefix(0, 0, 0), 0);
    }
}

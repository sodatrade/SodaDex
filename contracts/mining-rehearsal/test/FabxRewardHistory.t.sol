// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {IDewebMining} from "fabx/src/pod/lib/DewebMiningExtension.sol";
import {DewebEpochRegistry} from "fabx/src/deweb/DewebEpochRegistry.sol";

interface IFabxTimeHistory {
    function rewardHistoryVersion() external view returns (uint256);
    function rewardReceiptCount(bytes32 key, address recipient) external view returns (uint256);
    function rewardPaidThrough(bytes32 key, address recipient, uint256 first, uint256 last, uint256 timestamp)
        external view returns (uint256);
    function paidTo(bytes32 key, address recipient) external view returns (uint256);
}

/// @dev Real source, real Deweb epochs and actual cap clipping; no invented timestamps.
contract FabxRewardHistoryTest is OkbBoostBase {
    IFabxTimeHistory private history;
    uint256 private id;
    bytes32 private key;
    bytes32 private leader;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        uint32 task = _addNotTask();
        leader = _startVerified(alice, _tape(alice), task);
        id = _tape(bob);
        key = _startVerified(bob, id, task);
        history = IFabxTimeHistory(address(pod));
        assertEq(history.rewardHistoryVersion(), 2);
    }

    function test_timePrefixMatchesRealPendingAcrossGlobalWeightChange() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 cut = vm.getBlockTimestamp();
        uint256 early = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.prank(alice);
        pod.stop(leader);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 count = history.rewardReceiptCount(key, bob);
        assertEq(history.rewardPaidThrough(key, bob, 0, count, cut), early);
        assertEq(history.rewardPaidThrough(key, bob, 0, count, vm.getBlockTimestamp()), xmake.balanceOf(bob));
        assertGt(xmake.balanceOf(bob) - early, early, "remaining miner earns more after leader leaves");
    }

    function test_supplyCapClipsBothTimeSegmentsProportionally() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 cut = vm.getBlockTimestamp();
        uint256 early = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.prank(alice);
        pod.stop(leader);
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 gross = IDewebMining(address(pod)).pendingWithDeweb(key);
        uint256 fill = xmake.MAX_SUPPLY() - xmake.totalSupply() - 101;
        vm.prank(address(pod));
        xmake.mint(owner, fill);
        pod.claim(key);
        uint256 count = history.rewardReceiptCount(key, bob);
        uint256 first = history.rewardPaidThrough(key, bob, 0, count, cut);
        uint256 total = history.rewardPaidThrough(key, bob, 0, count, vm.getBlockTimestamp());
        assertEq(first, 101 * early / gross);
        assertEq(total, 101);
        assertEq(first + (total - first), xmake.balanceOf(bob));
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        assertEq(history.rewardReceiptCount(key, bob), count, "zero payment never revives consumed income");
    }

    function test_frozenReceiptRangesIgnoreFutureThirdPartyClaims() public {
        vm.warp(vm.getBlockTimestamp() + 50);
        pod.claim(key);
        uint256 first = history.rewardReceiptCount(key, bob);
        uint256 paidBefore = xmake.balanceOf(bob);
        vm.warp(vm.getBlockTimestamp() + 50);
        uint256 cut = vm.getBlockTimestamp();
        uint256 pending = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.warp(vm.getBlockTimestamp() + 50);
        vm.prank(keeper);
        pod.claim(key);
        uint256 last = history.rewardReceiptCount(key, bob);
        uint256 frozen = history.rewardPaidThrough(key, bob, first, last, cut);
        assertEq(frozen, pending);
        vm.warp(vm.getBlockTimestamp() + 50);
        pod.claim(key);
        assertEq(history.rewardPaidThrough(key, bob, first, last, cut), frozen);
        assertEq(history.rewardPaidThrough(key, bob, 0, first, cut), paidBefore);
    }

    function test_lazyExtraCreditSpansEpochsWithoutLosingItsOriginalTime() public {
        vm.warp(100 days);
        pod.claim(key);
        uint256 first = history.rewardReceiptCount(key, bob);
        DewebEpochRegistry registry = new DewebEpochRegistry(owner, address(pod), address(circuits));
        vm.prank(owner);
        IDewebMining(address(pod)).setDewebRegistry(address(registry));
        _applyEpoch(registry);
        uint64 epoch = registry.currentEpoch();
        uint256 end = (uint256(epoch) + 1) * 1 days - 6 hours;
        vm.warp(end - 100);
        uint256 cut = vm.getBlockTimestamp();
        uint256 early = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.warp(end + 100);
        _applyEpoch(registry);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 last = history.rewardReceiptCount(key, bob);
        assertEq(history.rewardPaidThrough(key, bob, first, last, cut), early);
        assertEq(history.rewardPaidThrough(key, bob, first, last, vm.getBlockTimestamp()),
            history.paidTo(key, bob) - history.rewardPaidThrough(key, bob, 0, first, vm.getBlockTimestamp()));
    }

    function test_pauseAcrossSevenDayCutPreservesAccrualAndHistoricalPayments() public {
        uint256 from = vm.getBlockTimestamp();
        vm.prank(owner);
        pod.pause();
        vm.warp(from + 7 days);
        uint256 early = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.warp(from + 8 days);
        vm.prank(owner);
        pod.unpause();
        pod.claim(key);
        uint256 count = history.rewardReceiptCount(key, bob);
        assertEq(history.rewardPaidThrough(key, bob, 0, count, from + 7 days), early);
        vm.prank(owner);
        pod.pause();
        assertEq(history.rewardPaidThrough(key, bob, 0, count, vm.getBlockTimestamp()), xmake.balanceOf(bob));
    }

    function test_sameEpochExtraReweighPiecesKeepTheirInternalCuts() public {
        vm.warp(100 days);
        pod.claim(key);
        uint256 first = history.rewardReceiptCount(key, bob);
        DewebEpochRegistry registry = new DewebEpochRegistry(owner, address(pod), address(circuits));
        vm.prank(owner);
        IDewebMining(address(pod)).setDewebRegistry(address(registry));
        _applyEpoch(registry);
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 cutA = vm.getBlockTimestamp();
        uint256 grossA = IDewebMining(address(pod)).pendingWithDeweb(key);
        uint64 epoch = registry.currentEpoch();
        IDewebMining(address(pod)).applyDewebBoost(key, epoch, 7000, new bytes32[](0));
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 cutB = vm.getBlockTimestamp();
        uint256 grossB = IDewebMining(address(pod)).pendingWithDeweb(key);
        IDewebMining(address(pod)).applyDewebBoost(key, epoch, 7000, new bytes32[](0));
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 last = history.rewardReceiptCount(key, bob);
        assertEq(history.rewardPaidThrough(key, bob, first, last, cutA), grossA);
        assertEq(history.rewardPaidThrough(key, bob, first, last, cutB), grossB);
    }

    function test_ownerRoundTripKeepsSeparateTimeRangesAndCounterTotals() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 firstPaid = history.paidTo(key, bob);
        vm.prank(bob);
        circuits.transferFrom(bob, alice, id);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 alicePaid = history.paidTo(key, alice);
        vm.prank(alice);
        circuits.transferFrom(alice, bob, id);
        vm.warp(vm.getBlockTimestamp() + 50);
        uint256 cut = vm.getBlockTimestamp();
        uint256 pending = IDewebMining(address(pod)).pendingWithDeweb(key);
        vm.warp(vm.getBlockTimestamp() + 50);
        pod.claim(key);
        assertEq(history.rewardPaidThrough(key, bob, 0, history.rewardReceiptCount(key, bob), cut), firstPaid + pending);
        assertEq(history.rewardPaidThrough(key, alice, 0, history.rewardReceiptCount(key, alice), cut), alicePaid);
    }

    function _applyEpoch(DewebEpochRegistry registry) private {
        uint64 epoch = registry.currentEpoch();
        bytes32 leaf = registry.leaf(epoch, address(circuits), id, 7000);
        vm.prank(owner);
        registry.submitReport(epoch, leaf, keccak256(abi.encode(epoch)));
        IDewebMining(address(pod)).applyDewebBoost(key, epoch, 7000, new bytes32[](0));
    }
}

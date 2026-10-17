// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {PodMining} from "fabx/src/pod/PodMining.sol";
import {PodMining as LegacyPodMining} from "fabx-baseline/src/pod/PodMining.sol";
import {IDewebMining} from "fabx/src/pod/lib/DewebMiningExtension.sol";
import {DewebEpochRegistry} from "fabx/src/deweb/DewebEpochRegistry.sol";

interface IPaidMiningRewards {
    function paidTo(bytes32 key, address recipient) external view returns (uint256);
}

/// @dev Actual pinned FABX contracts with a test-only accounting patch. No RPC or wallet.
contract FabxPaidRewardsTest is OkbBoostBase {
    IPaidMiningRewards private rewards;
    uint256 private id;
    bytes32 private key;
    bytes32 private leaderKey;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        uint32 task = _addNotTask();
        leaderKey = _startVerified(alice, _tape(alice), task);
        id = _tape(bob);
        key = _startVerified(bob, id, task);
        rewards = IPaidMiningRewards(address(pod));
    }

    function test_thirdPartyClaimsCountActualPaidNotDonations() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(keeper);
        pod.claim(key);
        uint256 first = xmake.balanceOf(bob);
        assertGt(first, 0);
        assertEq(rewards.paidTo(key, bob), first);
        vm.prank(owner);
        assertTrue(xmake.transfer(bob, 1e8));
        assertEq(rewards.paidTo(key, bob), first, "donation is not mining output");
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob) - 1e8);
        assertEq(rewards.paidTo(key, keeper), 0);
    }

    function test_eachOwnerHasIndependentCumulativePaidBaseline() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 bobPaid = rewards.paidTo(key, bob);
        vm.prank(bob);
        circuits.transferFrom(bob, alice, id);
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 aliceBefore = xmake.balanceOf(alice);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), bobPaid);
        assertEq(rewards.paidTo(key, alice), xmake.balanceOf(alice) - aliceBefore);
        assertGt(rewards.paidTo(key, alice), 0);
    }

    function test_supplyCapOnlyRecordsClippedAmountAndNoDoubleCount() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.poke();
        assertGt(pod.pending(key), 10);
        uint256 fill = xmake.MAX_SUPPLY() - xmake.totalSupply() - 10;
        vm.prank(address(pod));
        xmake.mint(owner, fill);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), 10);
        assertEq(xmake.balanceOf(bob), 10);
        assertEq(pod.pending(key), 0);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), 10);
        assertEq(pod.pending(key), 0);
    }

    function test_failedMintRollsBackDebtCounterAndTokenBalance() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.poke();
        uint256 pendingBefore = pod.pending(key);
        bytes32 minerBefore = keccak256(abi.encode(pod.getMiner(key)));
        uint256 minedBefore = pod.totalMined();
        vm.mockCallRevert(address(xmake), abi.encodeWithSelector(xmake.mint.selector), hex"feedface");
        vm.expectRevert(bytes4(0xfeedface));
        pod.claim(key);
        assertEq(keccak256(abi.encode(pod.getMiner(key))), minerBefore);
        assertEq(pod.pending(key), pendingBefore);
        assertEq(pod.totalMined(), minedBefore);
        assertEq(rewards.paidTo(key, bob), 0);
        assertEq(xmake.balanceOf(bob), 0);
        vm.clearMockedCalls();
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), pendingBefore);
    }

    function test_pauseDoesNotFabricatePayoutAndRecoveryCountsOnce() public {
        vm.prank(owner);
        pod.pause();
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.poke();
        assertGt(pod.pending(key), 0);
        assertEq(rewards.paidTo(key, bob), 0);
        vm.expectRevert(bytes4(keccak256("EnforcedPause()")));
        pod.claim(key);
        vm.prank(owner);
        pod.unpause();
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob));
    }

    function test_failureAfterMintRollsBackTheEntireHarvest() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.poke();
        uint256 pendingBefore = pod.pending(key);
        bytes32 minerBefore = keccak256(abi.encode(pod.getMiner(key)));
        uint256 minedBefore = pod.totalMined();
        vm.mockCallRevert(address(boost), abi.encodeWithSignature("factorBps(address)", bob), hex"feedface");
        vm.expectRevert(bytes4(0xfeedface));
        pod.claim(key);
        assertEq(keccak256(abi.encode(pod.getMiner(key))), minerBefore);
        assertEq(pod.pending(key), pendingBefore);
        assertEq(pod.totalMined(), minedBefore);
        assertEq(rewards.paidTo(key, bob), 0);
        assertEq(xmake.balanceOf(bob), 0);
    }

    function test_stopHarvestUsesSameActualPaidCounter() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(bob);
        pod.stop(key);
        assertGt(xmake.balanceOf(bob), 0);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob));
    }

    function test_permissionlessPromotionKeepsActiveBaseWeightAndCountsItsHarvest() public {
        PodMining.Miner memory beforeMiner = pod.getMiner(key);
        assertFalse(beforeMiner.optimal);
        assertEq(beforeMiner.status, 1);
        vm.prank(alice);
        pod.stop(leaderKey);
        vm.roll(vm.getBlockNumber() + pod.STOP_COOLDOWN() + 1);
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(keeper);
        pod.reclaim(key);
        PodMining.Miner memory afterMiner = pod.getMiner(key);
        assertTrue(afterMiner.optimal);
        assertEq(afterMiner.status, 1);
        assertEq(uint256(afterMiner.bstar) * afterMiner.mult, uint256(beforeMiner.bstar) * beforeMiner.mult);
        assertGt(afterMiner.bonus, beforeMiner.bonus);
        assertGt(afterMiner.verifWeight, beforeMiner.verifWeight);
        assertGt(rewards.paidTo(key, bob), 0);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob));
        assertEq(rewards.paidTo(key, keeper), 0);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob));
    }

    function test_attackerCannotForgeAccountingThroughFallback() public {
        vm.prank(keeper);
        (bool success,) = address(pod)
            .call(
                abi.encodeWithSignature(
                    "prepareHarvest(bytes32,uint256,address,address,uint256)",
                    key,
                    1e20,
                    address(xmake),
                    address(circuits),
                    id
                )
            );
        assertFalse(success);
        assertEq(rewards.paidTo(key, keeper), 0);
        assertEq(rewards.paidTo(key, bob), 0);
    }

    function test_upgradePreservesExistingMinerAndDewebCreditWithoutBackfillingPastPayments() public {
        vm.warp(100 days);
        LegacyPodMining legacy = new LegacyPodMining();
        vm.prank(owner);
        pod.upgradeToAndCall(address(legacy), "");
        DewebEpochRegistry registry = new DewebEpochRegistry(owner, address(pod), address(circuits));
        vm.prank(owner);
        IDewebMining(address(pod)).setDewebRegistry(address(registry));
        uint64 epoch = registry.currentEpoch();
        bytes32 reportRoot = registry.leaf(epoch, address(circuits), id, 7000);
        vm.prank(owner);
        registry.submitReport(epoch, reportRoot, keccak256("upgrade-test"));
        IDewebMining(address(pod)).applyDewebBoost(key, epoch, 7000, new bytes32[](0));
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.claim(key);
        uint256 legacyPaid = xmake.balanceOf(bob);
        assertGt(legacyPaid, 0);
        vm.warp(vm.getBlockTimestamp() + 100);
        pod.poke();
        bytes32 beforeState = _state();
        PodMining replacement = new PodMining();
        vm.prank(owner);
        pod.upgradeToAndCall(address(replacement), "");
        assertEq(_state(), beforeState, "existing storage and namespaced reward state must survive");
        assertEq(rewards.paidTo(key, bob), 0, "counter starts at activation; no invented history");
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob) - legacyPaid);
        assertGt(rewards.paidTo(key, bob), 0);
    }

    function testFuzz_cumulativePaidEqualsActualMintAcrossOwnerChanges(uint32 first, uint32 second) public {
        first = uint32(bound(first, 1, 30 days));
        second = uint32(bound(second, 1, 30 days));
        vm.warp(vm.getBlockTimestamp() + first);
        pod.claim(key);
        vm.prank(bob);
        circuits.transferFrom(bob, alice, id);
        uint256 aliceBefore = xmake.balanceOf(alice);
        vm.warp(vm.getBlockTimestamp() + second);
        pod.claim(key);
        assertEq(rewards.paidTo(key, bob), xmake.balanceOf(bob));
        assertEq(rewards.paidTo(key, alice), xmake.balanceOf(alice) - aliceBefore);
    }

    function _state() private view returns (bytes32) {
        (uint64 epoch, uint64 until, uint256[2] memory raw) = IDewebMining(address(pod)).dewebState();
        (uint256 v, uint256 u, uint256 tv, uint256 tu) = IDewebMining(address(pod)).dewebWeights(key);
        return keccak256(
            abi.encode(
                pod.owner(),
                pod.token(),
                pod.totalMined(),
                pod.totalVerifWeight(),
                pod.totalUnverWeight(),
                pod.getMiner(key),
                pod.pending(key),
                epoch,
                until,
                raw,
                v,
                u,
                tv,
                tu
            )
        );
    }
}

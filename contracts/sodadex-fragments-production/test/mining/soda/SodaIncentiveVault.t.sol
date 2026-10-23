// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { SodaPolicy } from "../../../src/mining/soda/SodaPolicy.sol";
import { SodaIncentiveVault } from "../../../src/mining/soda/SodaIncentiveVault.sol";
import { SodaIgnixPool } from "../../../src/mining/soda/SodaIgnixPool.sol";
import { IgnixLpRewards } from "../../../src/mining/soda/IgnixLpRewards.sol";
import { SodaActor } from "./SodaSplitInvariant.t.sol";
import {
    MockMiningFab,
    MockMiningNft,
    MockMiningFactory,
    MockFabxMining
} from "../MiningProductMocks.sol";

abstract contract SodaIncentiveFixture is Test {
    MockMiningFab fab;
    MockFabxMining mining;
    SodaPolicy policy;
    SodaIncentiveVault vault;
    SodaIgnixPool pool;
    IgnixLpRewards rewards;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address treasury = 0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A;

    function setUp() public virtual {
        fab = new MockMiningFab();
        MockMiningFactory factory = new MockMiningFactory();
        MockMiningNft nft = new MockMiningNft(address(factory));
        factory.register(address(nft));
        mining = new MockFabxMining(fab, nft);
        policy = new SodaPolicy(treasury, treasury, fab);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new SodaIncentiveVault(fab, mining, nft, address(factory), 8, policy, predicted);
        pool = new SodaIgnixPool(vault, treasury);
        assertEq(predicted, address(pool));
        rewards = pool.REWARDS();
        for (uint256 i = 1; i <= 2; ++i) {
            address user = i == 1 ? alice : bob;
            nft.mint(user, i);
            mining.admit(i, 18);
            vm.deal(user, 1000 ether);
            vm.startPrank(user);
            nft.approve(address(vault), i);
            vault.deposit(i, 1);
            vault.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function add(address user) internal {
        vm.prank(user);
        pool.addLiquidity{ value: 1 ether }(9000 ether, 1, 1, block.timestamp);
    }

    function pendingFab(address user) internal view returns (uint256 amount) {
        (amount,) = rewards.claimable(user);
    }
}

contract SodaIncentiveVaultTest is SodaIncentiveFixture {
    function test_ownerAndTreasuryAreUnifiedAndBindingsCannotBeRedirected() public {
        assertEq(policy.owner(), treasury);
        assertEq(policy.treasury(), treasury);
        assertEq(pool.INCOME().RECIPIENT(), treasury);
        assertEq(vault.LP_POOL(), address(pool));
        assertEq(address(vault.lpRewards()), address(rewards));
        assertEq(rewards.INCENTIVE_SOURCE(), address(vault));
        vm.expectRevert();
        policy.setPaused(0, true, "unauthorized");
        vm.prank(treasury);
        policy.setPaused(0, true, "test");
        assertTrue(policy.paused(0));
    }

    function test_realVaultSplits85And10And5WithoutDoubleCounting() public {
        add(alice);
        mining.setPending(1, 100e8);
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 100e8);
        assertEq(vault.cumulativeIncentiveFab(), 5e8);
        assertEq(rewards.cumulativeIncentiveFab(), 5e8);
        assertApproxEqAbs(rewards.cumulativePoolFab(), 2125000000, 1);
        assertApproxEqAbs(pendingFab(alice), 2625000000, 2);
        assertEq(pendingFab(bob), 0);
        assertEq(policy.fabOwed(treasury), 10e8);
        assertEq(pool.INCOME().cumulativeLpFab(), 0);
        assertEq(fab.allowance(address(vault), address(rewards)), 0);
        assertEq(fab.allowance(address(vault), address(policy)), 0);
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 100e8);
        assertEq(rewards.cumulativeIncentiveFab(), 5e8);
        uint256 claimable = pendingFab(alice);
        rewards.claimFabFor(alice);
        assertEq(fab.balanceOf(alice), claimable);
        policy.claimFor(treasury);
        assertEq(fab.balanceOf(treasury), 10e8);
    }

    function test_directMiningClaimIsRecognizedExactlyOnce() public {
        add(alice);
        mining.setPending(1, 100e8);
        mining.claim(mining.keyOf(1));
        assertEq(fab.balanceOf(address(vault)), 100e8);
        pool.harvest();
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 100e8);
        assertEq(rewards.cumulativeIncentiveFab(), 5e8);
    }

    function test_newLpCannotTakePreviousIncentiveOrPoolDividend() public {
        add(alice);
        mining.setPending(1, 100e8);
        add(bob);
        assertApproxEqAbs(pendingFab(alice), 2625000000, 2);
        assertEq(pendingFab(bob), 0);
        mining.setPending(1, 100e8);
        pool.harvest();
        assertApproxEqAbs(pendingFab(bob), 2375000000, 3);
    }

    function test_exitKeepsHistoricalEarningsAndDoesNotReceiveFutureIncentives() public {
        add(alice);
        add(bob);
        mining.setPending(1, 100e8);
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, block.timestamp);
        uint256 earned = pendingFab(alice);
        assertGt(earned, 0);
        mining.setPending(1, 100e8);
        pool.harvest();
        assertEq(pendingFab(alice), earned);
        rewards.claimFabFor(alice);
        assertEq(fab.balanceOf(alice), earned);
    }

    function test_transferSettlesBeforeChangingLpOwner() public {
        add(alice);
        mining.setPending(1, 100e8);
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, lp);
        assertApproxEqAbs(pendingFab(alice), 2625000000, 2);
        assertEq(pendingFab(bob), 0);
        mining.setPending(1, 100e8);
        pool.harvest();
        assertApproxEqAbs(pendingFab(bob), 2625000000, 2);
    }

    function test_noLpIncentivesCannotBeClaimedByFutureDepositors() public {
        mining.setPending(1, 100e8);
        vault.harvest();
        assertEq(rewards.unallocatedFab(), 5e8);
        add(alice);
        assertEq(pendingFab(alice), 0);
        assertEq(rewards.unallocatedFab(), 5e8);
    }

    function test_cachedRewardsRemainClaimableWhenMiningIsPaused() public {
        add(alice);
        mining.setPending(1, 100e8);
        pool.harvest();
        uint256 earned = pendingFab(alice);
        mining.setPaused(true);
        rewards.claimFabFor(alice);
        assertEq(fab.balanceOf(alice), earned);
    }

    function testFuzz_splitConservesEveryBaseUnit(uint96 raw) public {
        add(alice);
        uint256 amount = bound(raw, 1, 1000000e8);
        mining.setPending(1, amount);
        vault.harvest();
        (uint256 holderDebt,) = vault.rewardLiabilities();
        assertEq(holderDebt + policy.fabOwed(treasury) + rewards.cumulativeIncentiveFab(), amount);
        assertEq(rewards.cumulativeIncentiveFab(), amount * 500 / 10000);
        assertEq(policy.fabOwed(treasury), amount * 1000 / 10000);
    }
}

contract SodaIncentiveVaultInvariantTest is SodaIncentiveFixture {
    function setUp() public override {
        super.setUp();
        add(alice);
        add(bob);
        targetContract(address(new SodaActor(pool, vault, mining, alice, bob)));
    }

    function invariant_miningIncomeAndPrincipalStayFullyBacked() public view {
        assertEq(address(pool).balance, pool.reserveOkb());
        assertEq(vault.balanceOf(address(pool)), pool.reserveShares());
        (uint256 holderDebt,) = vault.rewardLiabilities();
        (uint256 lpDebt, uint256 nativeDebt) = rewards.rewardLiabilities();
        assertGe(fab.balanceOf(address(vault)), holderDebt);
        assertGe(fab.balanceOf(address(rewards)), lpDebt);
        assertGe(address(rewards).balance, nativeDebt);
        assertEq(vault.cumulativeIncentiveFab(), rewards.cumulativeIncentiveFab());
        assertEq(pool.REWARDS().totalSupply(), pool.totalSupply());
        assertEq(policy.owner(), treasury);
        assertEq(pool.INCOME().cumulativeLpFab(), 0);
        assertEq(fab.balanceOf(address(policy)), policy.fabOwed(treasury));
    }
}

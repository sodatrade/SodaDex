// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { SodaIncentiveFixture } from "./SodaIncentiveVault.t.sol";
import { SodaActor } from "./SodaSplitInvariant.t.sol";
import { SodaPool } from "../../../src/mining/soda/SodaPool.sol";
import { FabxMinerCustody } from "../../../src/mining/FabxMinerCustody.sol";
import { IgnixLpRewards } from "../../../src/mining/soda/IgnixLpRewards.sol";
import { SodaRewards } from "../../../src/mining/soda/SodaRewards.sol";
import { SodaVault } from "../../../src/mining/soda/SodaVault.sol";
import { MockMiningFab, MockFabxMining } from "../MiningProductMocks.sol";

contract FormalIncomeActor is SodaActor {
    SodaVault private immutable shares;
    MockFabxMining private immutable source;
    MockMiningFab private immutable asset;
    address private immutable first;
    address private immutable second;

    constructor(SodaPool p, SodaVault v, MockFabxMining m, address a, address b)
        SodaActor(p, v, m, a, b)
    {
        shares = v;
        source = m;
        asset = MockMiningFab(address(v.FAB()));
        first = a;
        second = b;
    }

    function externalClaim(uint96 value, bool secondMiner) external {
        uint256 id = secondMiner ? 2 : 1;
        source.setPending(id, bound(value, 0, 100e8));
        source.claim(source.keyOf(id));
    }

    function donate(uint96 value) external {
        asset.mint(address(this), bound(value, 0, 100e8));
        require(asset.transfer(address(shares), asset.balanceOf(address(this))));
    }

    function holderClaim(bool other) external {
        shares.claimFor(other ? second : first);
    }
}

contract SodaFormalCompatibilityTest is SodaIncentiveFixture {
    function testFuzz_allFourExcludedMinerTypesRemainRejected(uint8 raw) public {
        uint256 kind = bound(raw, 0, 3);
        mining.nft().mint(alice, 3);
        mining.admit(3, 18);
        if (kind == 0) mining.setPremium(3);
        else if (kind == 1) mining.setBoost(3);
        else if (kind == 2) mining.setUnverified(3);
        else mining.setDewebBoost(3);
        vm.startPrank(alice);
        mining.nft().approve(address(vault), 3);
        vm.expectRevert(FabxMinerCustody.IneligibleMiner.selector);
        vault.deposit(3, 1);
        vm.stopPrank();
        assertEq(mining.nft().ownerOf(3), alice);
        assertEq(vault.minerCount(), 2);
        assertEq(vault.totalSupply(), 36000 ether);
    }

    function test_sourceHasNoPaidToAndAllBindingsDeploy() public view {
        (bool ok,) = address(mining)
            .staticcall(
                abi.encodeWithSignature("paidTo(bytes32,address)", mining.keyOf(1), address(vault))
            );
        assertFalse(ok);
        assertEq(vault.minerCount(), 2);
        assertEq(vault.totalSupply(), 36000 ether);
    }

    function test_receiptsAndDonationsExcludeUnpaidDebtAndNeverRecount() public {
        add(alice);
        mining.setPending(1, 100e8);
        mining.claim(mining.keyOf(1));
        fab.mint(bob, 40e8);
        vm.prank(bob);
        assertTrue(fab.transfer(address(vault), 40e8));
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 140e8);
        assertEq(policy.fabOwed(treasury), 14e8);
        assertEq(rewards.cumulativeIncentiveFab(), 7e8);
        (uint256 debt,) = vault.rewardLiabilities();
        assertEq(fab.balanceOf(address(vault)), debt);
        vault.claimFor(alice);
        vault.claimFor(bob);
        rewards.claimFor(alice);
        policy.claimFor(treasury);
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 140e8);
        fab.mint(address(vault), 100e8);
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), 240e8);
        assertEq(rewards.cumulativeIncentiveFab(), 12e8);
        assertEq(policy.fabOwed(treasury), 10e8);
    }

    function test_shareTransferKeepsExternallyClaimedIncomeWithPreviousHolder() public {
        add(alice);
        mining.setPending(1, 100e8);
        mining.claim(mining.keyOf(1));
        uint256 balance = vault.balanceOf(alice);
        vm.prank(alice);
        assertTrue(vault.transfer(bob, balance));
        (uint256 earned,) = vault.claimable(alice);
        assertApproxEqAbs(earned, 2125000000, 1);
        assertEq(vault.cumulativeMiningFab(), 100e8);
        mining.setPending(1, 100e8);
        pool.harvest();
        (uint256 after_,) = vault.claimable(alice);
        assertEq(after_, earned);
    }

    function test_oldOwnerIncomeIsNotSplitAndRedepositDoesNotRecount() public {
        (uint256 shares, uint256 fee) = vault.previewRedeem(1);
        vm.prank(alice);
        vault.redeem{ value: fee }(1, shares);
        uint256 before_ = fab.balanceOf(alice);
        mining.setPending(1, 100e8);
        vm.startPrank(alice);
        mining.nft().approve(address(vault), 1);
        vault.deposit(1, 1);
        vm.stopPrank();
        assertEq(fab.balanceOf(alice) - before_, 100e8);
        assertEq(vault.cumulativeMiningFab(), 0);
        mining.setPending(1, 20e8);
        mining.claim(mining.keyOf(1));
        vault.harvest();
        assertEq(vault.cumulativeMiningFab(), 20e8);
    }

    function test_donationWithoutSharesStaysReservedForNoFutureDepositor() public {
        (uint256 shares, uint256 fee) = vault.previewRedeem(1);
        vm.prank(alice);
        vault.redeem{ value: fee }(1, shares);
        (shares, fee) = vault.previewRedeem(2);
        vm.prank(bob);
        vault.redeem{ value: fee }(2, shares);
        fab.mint(address(vault), 100e8);
        vault.harvest();
        vm.startPrank(alice);
        mining.nft().approve(address(vault), 1);
        vault.deposit(1, 1);
        vm.stopPrank();
        (uint256 claimable_,) = vault.claimable(alice);
        assertEq(claimable_, 0);
        assertEq(vault.cumulativeMiningFab(), 100e8);
        assertEq(rewards.unallocatedFab(), 5e8);
        (uint256 debt,) = vault.rewardLiabilities();
        assertEq(debt, 85e8);
    }

    function test_cachedHolderClaimsWorkWhileSourcePaused() public {
        fab.mint(address(vault), 100e8);
        vault.harvest();
        mining.setPaused(true);
        (uint256 earned,) = vault.claimable(alice);
        vault.claimFor(alice);
        assertEq(fab.balanceOf(alice), earned);
    }

    function test_claimToVaultCannotTurnReservedFabIntoNewIncome() public {
        vm.prank(bob);
        assertTrue(vault.transfer(address(vault), 18000 ether));
        fab.mint(address(vault), 100e8);
        vault.harvest();
        (uint256 selfDebt,) = vault.claimable(address(vault));
        assertGt(selfDebt, 0);
        uint256 before_ = fab.balanceOf(address(vault));
        vm.expectRevert(SodaRewards.InvalidBinding.selector);
        vault.claimFor(address(vault));
        vault.harvest();
        assertEq(vault.cumulativeMiningFab(), 100e8);
        assertEq(fab.balanceOf(address(vault)), before_);
    }

    function test_claimToRewardsCannotRecountItsOwnLpIncome() public {
        add(alice);
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        assertTrue(pool.transfer(address(rewards), lp));
        mining.setPending(1, 100e8);
        pool.harvest();
        uint256 poolIncome = rewards.cumulativePoolFab();
        (uint256 selfDebt,) = rewards.claimable(address(rewards));
        assertGt(selfDebt, 0);
        vm.expectRevert(IgnixLpRewards.InvalidBinding.selector);
        rewards.claimFabFor(address(rewards));
        pool.harvest();
        assertEq(rewards.cumulativePoolFab(), poolIncome);
        assertEq(vault.cumulativeMiningFab(), 100e8);
    }

    function test_missingBackingFailsBeforeAnyNewSplit() public {
        fab.mint(address(vault), 100e8);
        vault.harvest();
        vm.prank(address(vault));
        assertTrue(fab.transfer(bob, 1));
        vm.expectRevert(SodaVault.InsufficientFabBacking.selector);
        vault.harvest();
        assertEq(vault.cumulativeMiningFab(), 100e8);
    }
}

contract SodaFormalCompatibilityInvariantTest is SodaIncentiveFixture {
    function setUp() public override {
        super.setUp();
        add(alice);
        add(bob);
        targetContract(address(new FormalIncomeActor(pool, vault, mining, alice, bob)));
    }

    function invariant_receiptsCoverAllDebtsWithoutTouchingLpPrincipal() public view {
        (uint256 debt,) = vault.rewardLiabilities();
        (uint256 lpFab, uint256 lpOkb) = rewards.rewardLiabilities();
        assertGe(fab.balanceOf(address(vault)), debt);
        assertGe(fab.balanceOf(address(rewards)), lpFab);
        assertGe(address(rewards).balance, lpOkb);
        assertEq(fab.balanceOf(address(policy)), policy.fabOwed(treasury));
        assertEq(address(pool).balance, pool.reserveOkb());
        assertEq(vault.balanceOf(address(pool)), pool.reserveShares());
        assertEq(rewards.totalSupply(), pool.totalSupply());
        assertEq(vault.cumulativeIncentiveFab(), rewards.cumulativeIncentiveFab());
    }
}

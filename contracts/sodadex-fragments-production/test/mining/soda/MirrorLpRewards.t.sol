// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockMiningFab} from "../MiningProductMocks.sol";
import {SodaPolicy} from "../../../src/mining/soda/SodaPolicy.sol";
import {SodaVault} from "../../../src/mining/soda/SodaVault.sol";
import {MirrorSodaPool} from "../../../src/mining/soda/MirrorSodaPool.sol";
import {MirrorLpRewards} from "../../../src/mining/soda/MirrorLpRewards.sol";
import {EpochRewardLedger} from "../../../src/mining/soda/EpochRewardLedger.sol";

/// @dev Explicit proposed IGNIX protocol fixture, not a claim that f0ca687 already has these hooks.
contract EpochVaultFixture is ERC20 {
    bytes32 public constant LP_REWARDS_VERSION = keccak256("SodaDEX.MirrorEpochRewards.v1");
    MockMiningFab public immutable FAB;
    SodaPolicy public immutable POLICY;
    uint64 public openEpoch = 1;
    MirrorSodaPool public pool;
    MirrorLpRewards public rewards;
    uint256 public weight;
    uint256 public lastTime;

    constructor(MockMiningFab fab, SodaPolicy policy) ERC20("FAB Miner Shares", "FABS") {
        FAB = fab;
        POLICY = policy;
        lastTime = block.timestamp;
    }

    function bind(MirrorSodaPool value) external {
        require(address(pool) == address(0));
        pool = value;
        rewards = MirrorLpRewards(address(value.REWARDS()));
    }

    function mint(address who, uint256 amount) external {
        _mint(who, amount);
    }

    function totalEligibleWeight() external pure returns (uint256) {
        return 1;
    }

    function harvest() external {
        _sync();
    }

    function _sync() private {
        if (address(pool) == address(0)) return;
        weight += balanceOf(address(pool)) * (block.timestamp - lastTime);
        lastTime = block.timestamp;
        rewards.checkpoint(openEpoch, weight);
    }

    function close() external returns (uint64 e) {
        _sync();
        e = openEpoch;
        rewards.closeEpoch(e, weight);
        openEpoch++;
    }

    function fund(uint64 e, uint256 poolFab, uint256 incentive) external {
        FAB.mint(address(this), poolFab + incentive);
        FAB.approve(address(rewards), poolFab + incentive);
        rewards.notifyEpochRewards(e, poolFab, incentive);
    }

    function _update(address from, address to, uint256 value) internal override {
        _sync();
        super._update(from, to, value);
    }
}

contract MirrorLpRewardsTest is Test {
    MockMiningFab fab;
    SodaPolicy policy;
    EpochVaultFixture vault;
    MirrorSodaPool pool;
    MirrorLpRewards rewards;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0x777);
    uint256 clock;

    function setUp() public {
        clock = 1800000000;
        vm.warp(clock);
        fab = new MockMiningFab();
        policy = new SodaPolicy(address(this), treasury, IERC20(address(fab)));
        vault = new EpochVaultFixture(fab, policy);
        pool = new MirrorSodaPool(SodaVault(address(vault)), treasury);
        vault.bind(pool);
        rewards = MirrorLpRewards(address(pool.REWARDS()));
        assertEq(rewards.VERSION(), keccak256("SodaDEX.MirrorEpochRewards.v1"));
        for (uint256 i; i < 2; i++) {
            address a = i == 0 ? alice : bob;
            vault.mint(a, 10000 ether);
            vm.deal(a, 100 ether);
            vm.prank(a);
            vault.approve(address(pool), type(uint256).max);
        }
    }

    function wait(uint256 dt) internal {
        clock += dt;
        vm.warp(clock);
        vm.roll(block.number + 1);
    }

    function add(address who) internal returns (uint256 lp) {
        vm.prank(who);
        lp = pool.addLiquidity{value: 1 ether}(100 ether, 0, 0, type(uint256).max);
    }

    function payableFab(address who) internal view returns (uint256 f) {
        (f,) = rewards.claimable(who);
    }

    function test_transferPreservesBothStreams() public {
        uint256 lp = add(alice);
        wait(1800);
        vm.prank(alice);
        pool.transfer(bob, lp);
        wait(1800);
        uint64 e = vault.close();
        assertEq(payableFab(alice), 0);
        vault.fund(e, 100e8, 20e8);
        assertApproxEqAbs(payableFab(alice), 60e8, 2);
        assertApproxEqAbs(payableFab(bob), 60e8, 2);
        rewards.claimFabFor(alice);
        assertApproxEqAbs(fab.balanceOf(alice), 60e8, 2);
    }

    function test_allExitBeforeConfirmationKeepEntireIncentive() public {
        uint256 lp = add(alice);
        wait(1800);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, type(uint256).max);
        wait(1800);
        uint64 e = vault.close();
        assertEq(pool.totalSupply(), 0);
        assertEq(rewards.activeSeconds(e), 1800);
        vault.fund(e, 100e8, 20e8);
        assertApproxEqAbs(payableFab(alice), 120e8, 2);
        add(bob);
        assertEq(payableFab(bob), 0);
        rewards.claimFabFor(alice);
        assertGt(fab.balanceOf(alice), 0);
    }

    function test_gapDoesNotDiluteHistoricalIncentive() public {
        uint256 lp = add(alice);
        wait(100);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, type(uint256).max);
        wait(800);
        add(bob);
        wait(100);
        uint64 e = vault.close();
        vault.fund(e, 100e8, 20e8);
        assertEq(rewards.activeSeconds(e), 200);
        assertApproxEqAbs(payableFab(alice), 60e8, 2);
        assertApproxEqAbs(payableFab(bob), 60e8, 2);
    }

    function test_directShareTransferDoesNotRewriteEarlierIncome() public {
        uint256 lp = add(alice);
        wait(100);
        vm.prank(bob);
        vault.transfer(address(pool), 100 ether);
        vm.prank(alice);
        pool.transfer(bob, lp);
        wait(100);
        uint64 e = vault.close();
        vault.fund(e, 300e8, 20e8);
        assertApproxEqAbs(payableFab(alice), 110e8, 2);
        assertApproxEqAbs(payableFab(bob), 210e8, 2);
    }

    function test_zeroEpochAndDuplicateFunding() public {
        add(alice);
        wait(10);
        uint64 e = vault.close();
        vault.fund(e, 0, 0);
        vm.expectRevert(EpochRewardLedger.EpochOrder.selector);
        vault.fund(e, 100, 100);
        assertEq(fab.balanceOf(address(rewards)), 0);
    }

    function test_noLpHistoryRejectsIncentive() public {
        wait(100);
        uint64 e = vault.close();
        vm.expectRevert(MirrorLpRewards.NoHistoricalLp.selector);
        vault.fund(e, 0, 100);
        vault.fund(e, 0, 0);
    }

    function test_poolFabInEmptyPoolRemainsReserved() public {
        vm.prank(bob);
        vault.transfer(address(pool), 100 ether);
        wait(100);
        uint64 e = vault.close();
        vault.fund(e, 100e8, 0);
        assertEq(rewards.unallocatedFab(), 100e8);
        add(alice);
        assertEq(payableFab(alice), 0);
    }

    function test_twoUnconfirmedSlotsAndLongHistory() public {
        uint256 lp = add(alice);
        wait(10);
        uint64 e = vault.close();
        wait(10);
        vm.prank(alice);
        pool.transfer(bob, lp / 2);
        vault.fund(e, 100e8, 20e8);
        wait(10);
        e = vault.close();
        vault.fund(e, 100e8, 20e8);
        assertApproxEqAbs(payableFab(alice), 210e8, 5);
        assertApproxEqAbs(payableFab(bob), 30e8, 5);
        for (uint256 i; i < 300; i++) {
            wait(10);
            e = vault.close();
            vault.fund(e, 100e8, 20e8);
        }
        assertApproxEqAbs(payableFab(alice), 18210e8, 1000);
        assertApproxEqAbs(payableFab(bob), 18030e8, 1000);
        uint256 gasBefore = gasleft();
        rewards.claimFabFor(alice);
        uint256 used = gasBefore - gasleft();
        assertLt(used, 350000, "claim must not iterate historical epochs");
    }

    function test_permissionlessFrequentClaimsPreserveFractionalTime() public {
        add(alice);
        add(bob);
        for (uint256 i; i < 100; i++) {
            wait(1);
            pool.harvest();
            rewards.claimFabFor(alice);
            rewards.claimFabFor(bob);
        }
        uint64 e = vault.close();
        vault.fund(e, 0, 20e8);
        assertApproxEqAbs(payableFab(alice), 10e8, 2);
        assertApproxEqAbs(payableFab(bob), 10e8, 2);
    }

    function test_okbFeesUnchanged() public {
        add(alice);
        vm.prank(bob);
        pool.swap{value: 0.1 ether}(false, 0.1 ether, 0, type(uint256).max);
        (, uint256 fee) = rewards.claimable(alice);
        assertApproxEqAbs(fee, 0.00035 ether, 1);
        uint256 beforeBalance = treasury.balance;
        pool.INCOME().claimPlatformOkb();
        assertEq(treasury.balance - beforeBalance, 0.00015 ether);
    }

    function testFuzz_multiActorHistoryIsFunded(uint256 seed) public {
        add(alice);
        add(bob);
        uint256 weightA;
        uint256 weightB;
        uint256 duration;
        uint256 expectedA;
        uint256 expectedB;
        for (uint256 i; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 dt = 1 + seed % 100;
            weightA += Math.mulDiv(pool.balanceOf(alice), dt * 1e36, pool.totalSupply());
            weightB += Math.mulDiv(pool.balanceOf(bob), dt * 1e36, pool.totalSupply());
            duration += dt;
            wait(dt);
            address from = seed % 2 == 0 ? alice : bob;
            address to = from == alice ? bob : alice;
            uint256 value = pool.balanceOf(from) / (2 + seed % 5);
            vm.prank(from);
            pool.transfer(to, value);
            if (i % 3 == 0) {
                uint256 amount = 120e8 + seed % 1000;
                expectedA += Math.mulDiv(amount, weightA, duration * 1e36);
                expectedB += Math.mulDiv(amount, weightB, duration * 1e36);
                weightA = 0;
                weightB = 0;
                duration = 0;
                uint64 e = vault.close();
                vault.fund(e, 100e8 + seed % 1000, 20e8);
            }
            assertApproxEqAbs(fab.balanceOf(alice) + payableFab(alice), expectedA, 100);
            assertApproxEqAbs(fab.balanceOf(bob) + payableFab(bob), expectedB, 100);
            if (seed % 3 == 0) rewards.claimFabFor(from);
            assertLe(payableFab(alice) + payableFab(bob), fab.balanceOf(address(rewards)));
            (uint256 liability,) = rewards.rewardLiabilities();
            assertEq(liability, fab.balanceOf(address(rewards)));
        }
    }
}

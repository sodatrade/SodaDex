// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FabxChallengeFixture} from "./FabxChallengeFixture.sol";

interface IRealFragmentVault {
    function deposit(uint256 id, uint256 minimumShares) external returns (uint256);
    function redeem(uint256 id, uint256 maximumShares) external returns (uint256);
    function harvest() external;
    function claimFor(address account) external returns (uint256);
    function claimable(address account) external view returns (uint256);
    function recognisedRewards() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function totalEligibleWeight() external view returns (uint256);
    function tradingEnabled() external view returns (bool);
    function approve(address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function previewRedeem(uint256 id) external view returns (uint256);
}

interface IRealFragmentPool {
    function syncPaid() external;
    function addLiquidity(uint256 shares, uint256 fab, uint256 minimumShares, uint256 minimumFab, uint256 deadline)
        external returns (uint256);
    function removeLiquidity(uint256 lp, uint256 minimumShares, uint256 minimumFab, uint256 deadline)
        external returns (uint256, uint256);
    function swapExactIn(bool shareIn, uint256 input, uint256 minimumOutput, uint256 deadline) external returns (uint256);
    function quoteExactIn(bool shareIn, uint256 input) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function reserveFab() external view returns (uint256);
    function reserveShares() external view returns (uint256);
    function rewardReserved() external view returns (uint256);
    function platformFabOwed() external view returns (uint256);
    function claimFor(address account) external returns (uint256);
    function harvest() external;
}

interface IRealPaidCounter {
    function paidTo(bytes32 key, address receiver) external view returns (uint256);
}

/// @dev Real 0.8.24 FABX fixture + independently compiled 0.8.26 product creation bytecode.
/// No RPC, private key, etch, production state or product mock is involved.
contract FabFragmentRealIntegrationTest is FabxChallengeFixture {
    IRealFragmentVault private vault;
    IRealFragmentPool private pool;
    bytes32 private leader;
    bytes32 private key;
    uint256 private minerId;
    uint32 private task;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        task = _addNotTask();
        leader = _startVerified(alice, _tape(alice), task);
        minerId = _tape(bob);
        key = _startVerified(bob, minerId, task);
        string memory artifacts = vm.envString("SODADEX_MINING_ARTIFACT_ROOT");
        vault = IRealFragmentVault(deployCode(
            string.concat(artifacts, "/FabFragmentVault.sol/FabFragmentVault.json"),
            abi.encode(address(xmake), address(pod), address(circuits), circuits.factory(), uint16(4))
        ));
        pool = IRealFragmentPool(deployCode(
            string.concat(artifacts, "/FabFragmentPool.sol/FabFragmentPool.json"),
            abi.encode(address(vault), treasury)
        ));
        vm.prank(owner);
        assertTrue(xmake.transfer(bob, 1_000e8));
        vm.startPrank(bob);
        circuits.approve(address(vault), minerId);
        vault.deposit(minerId, 6_000 ether);
        assertTrue(vault.approve(address(pool), type(uint256).max));
        assertTrue(xmake.approve(address(pool), type(uint256).max));
        vm.stopPrank();
    }

    function test_realSourcePaysOldHolderBeforeShareTransferAndAllowsNftRedemption() public {
        assertEq(circuits.ownerOf(minerId), address(vault));
        assertEq(vault.totalEligibleWeight(), 6);
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(bob);
        assertTrue(vault.transfer(alice, 3_000 ether));
        uint256 paid = IRealPaidCounter(address(pod)).paidTo(key, address(vault));
        assertGt(paid, 0);
        assertEq(vault.recognisedRewards(), paid);
        assertGt(vault.claimable(bob), 0);
        assertEq(vault.claimable(alice), 0);
        vm.warp(vm.getBlockTimestamp() + 100);
        vault.harvest();
        assertGt(vault.claimable(alice), 0);
        vm.prank(alice);
        assertTrue(vault.transfer(bob, 3_000 ether));
        vm.prank(bob);
        vault.redeem(minerId, 6_000 ether);
        assertEq(circuits.ownerOf(minerId), bob);
        assertEq(vault.totalSupply(), 0);
        uint256 before = xmake.balanceOf(alice);
        vault.claimFor(alice);
        assertGt(xmake.balanceOf(alice), before);
        assertEq(vault.recognisedRewards(), IRealPaidCounter(address(pod)).paidTo(key, address(vault)));
    }

    function test_realSourceBackedPoolRunsBothDirectionsAndLiquidityExit() public {
        vm.prank(bob);
        pool.addLiquidity(3_000 ether, 300e8, 3_000 ether, 300e8, vm.getBlockTimestamp());
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 expected = pool.quoteExactIn(false, 1e8);
        vm.prank(bob);
        assertEq(pool.swapExactIn(false, 1e8, expected, vm.getBlockTimestamp()), expected);
        uint256 sharesIn = 1 ether;
        expected = pool.quoteExactIn(true, sharesIn);
        vm.prank(bob);
        assertEq(pool.swapExactIn(true, sharesIn, expected, vm.getBlockTimestamp()), expected);
        assertEq(vault.balanceOf(address(pool)), pool.reserveShares());
        assertEq(xmake.balanceOf(address(pool)), pool.reserveFab() + pool.platformFabOwed() + pool.rewardReserved());
        uint256 lp = pool.balanceOf(bob);
        vm.prank(bob);
        pool.removeLiquidity(lp, 0, 0, vm.getBlockTimestamp());
        pool.claimFor(bob);
        assertEq(pool.reserveShares(), 0);
        assertEq(pool.reserveFab(), 0);
        assertEq(pool.balanceOf(bob), 0);
    }

    function test_permissionlessRealPromotionKeepsCustodiedBackingAndRedemption() public {
        vm.prank(alice);
        pod.stop(leader);
        vm.roll(vm.getBlockNumber() + pod.STOP_COOLDOWN() + 1);
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(keeper);
        pod.reclaim(key);
        assertTrue(pod.getMiner(key).optimal);
        assertEq(vault.totalEligibleWeight(), 6);
        assertTrue(vault.tradingEnabled());
        assertEq(vault.previewRedeem(minerId), 6_000 ether);
        vault.harvest();
        assertGt(vault.claimable(bob), 0);
        vm.prank(bob);
        vault.redeem(minerId, 6_000 ether);
        assertEq(circuits.ownerOf(minerId), bob);
    }

    function test_fullCapacityRealSourceGasAndExit() public {
        for (uint256 i; i < 3; ++i) {
            uint256 id = _tape(bob);
            _startVerified(bob, id, task);
            vm.startPrank(bob);
            circuits.approve(address(vault), id);
            vault.deposit(id, 0);
            vm.stopPrank();
        }
        vm.prank(bob);
        pool.addLiquidity(3_000 ether, 300e8, 0, 0, vm.getBlockTimestamp());
        vm.warp(vm.getBlockTimestamp() + 100);
        uint256 gasBefore = gasleft();
        vm.prank(bob);
        pool.swapExactIn(false, 1e8, 0, vm.getBlockTimestamp());
        emit log_named_uint("four-miner FAB-to-share gas", gasBefore - gasleft());
        gasBefore = gasleft();
        vm.prank(bob);
        pool.swapExactIn(true, 1 ether, 0, vm.getBlockTimestamp());
        emit log_named_uint("four-miner share-to-FAB gas", gasBefore - gasleft());
        uint256 lp = pool.balanceOf(bob);
        gasBefore = gasleft();
        vm.prank(bob);
        pool.removeLiquidity(lp, 0, 0, vm.getBlockTimestamp());
        emit log_named_uint("four-miner LP exit gas", gasBefore - gasleft());
        uint256 needed = vault.previewRedeem(minerId);
        gasBefore = gasleft();
        vm.prank(bob);
        vault.redeem(minerId, needed);
        emit log_named_uint("four-miner NFT redemption gas", gasBefore - gasleft());
        assertEq(circuits.ownerOf(minerId), bob);
    }

    function test_realSourcePauseBlocksSwapButPreservesBookedVaultAndLpClaims() public {
        vm.prank(bob);
        pool.addLiquidity(3_000 ether, 300e8, 0, 0, vm.getBlockTimestamp());
        vm.warp(vm.getBlockTimestamp() + 100);
        pool.harvest();
        assertGt(vault.claimable(bob), 0);
        vm.prank(owner);
        pod.pause();
        vm.expectRevert(bytes4(keccak256("MiningUnavailable()")));
        vm.prank(bob);
        pool.swapExactIn(false, 1e8, 1, vm.getBlockTimestamp());
        uint256 before = xmake.balanceOf(bob);
        vault.claimFor(bob);
        pool.claimFor(bob);
        assertGt(xmake.balanceOf(bob), before);
    }

    function _depositIncorrectMiner(uint32 vectorTask) private returns (uint256 id) {
        id = _tapeVector(bob, true);
        bytes32 badKey = _startVectorMiner(bob, id, vectorTask, true);
        assertFalse(pod.getMiner(badKey).optimal);
        assertEq(pod.getMiner(badKey).bonus, 0);
        assertEq(pod.getMiner(badKey).verifWeight, 39_000);
        vm.startPrank(bob);
        circuits.approve(address(vault), id);
        vault.deposit(id, 390_000 ether);
        vm.stopPrank();
    }

    function test_realChallengeInvalidatesAllBackingButKeepsHistoricalClaims() public {
        vm.prank(bob);
        vault.redeem(minerId, 6_000 ether);
        uint32 vectorTask = _addVectorTask();
        uint256 bad = _depositIncorrectMiner(vectorTask);
        vm.prank(bob);
        pool.addLiquidity(195_000 ether, 300e8, 0, 0, vm.getBlockTimestamp());
        uint256 supply = vault.totalSupply();
        uint256 shares = vault.balanceOf(bob);
        uint256 lp = pool.balanceOf(bob);
        vm.warp(vm.getBlockTimestamp() + 100);
        _challengeVector(bad);
        assertEq(pod.getMiner(pod.minerKey(address(circuits), bad)).status, 2);
        assertEq(vault.totalEligibleWeight(), 0);
        assertFalse(vault.tradingEnabled());
        assertEq(vault.totalSupply(), supply);
        assertEq(vault.balanceOf(bob), shares);
        assertEq(pool.balanceOf(bob), lp);
        vm.expectRevert(bytes4(keccak256("TradingUnavailable()")));
        pool.quoteExactIn(false, 1e8);
        vm.expectRevert(bytes4(keccak256("TradingUnavailable()")));
        vm.prank(bob);
        pool.swapExactIn(true, 1 ether, 1, vm.getBlockTimestamp());
        vm.expectRevert(bytes4(keccak256("NoEligibleBacking()")));
        vm.prank(bob);
        vault.deposit(minerId, 1);
        vm.expectRevert(bytes4(keccak256("IneligibleMiner()")));
        vm.prank(bob);
        vault.redeem(bad, supply);
        vault.harvest();
        vault.claimFor(address(pool));
        pool.syncPaid();
        uint256 before = xmake.balanceOf(bob);
        vault.claimFor(bob);
        pool.claimFor(bob);
        assertGt(xmake.balanceOf(bob), before);
        uint256 afterClaims = xmake.balanceOf(bob);
        vault.claimFor(bob);
        pool.claimFor(bob);
        assertEq(xmake.balanceOf(bob), afterClaims);
    }

    function test_realPartialChallengeSharesLossWithoutChangingIndividualBalances() public {
        vm.prank(bob);
        vault.redeem(minerId, 6_000 ether);
        uint32 vectorTask = _addVectorTask();
        uint256 first = _depositIncorrectMiner(vectorTask);
        uint256 second = _depositIncorrectMiner(vectorTask);
        uint256 shares = vault.balanceOf(bob);
        assertEq(vault.totalEligibleWeight(), 780);
        _challengeVector(first);
        assertEq(vault.totalEligibleWeight(), 390);
        assertEq(vault.balanceOf(bob), shares);
        assertTrue(vault.tradingEnabled());
        assertEq(vault.previewRedeem(second), shares, "one remaining miner now backs all unchanged shares");
        _challengeVector(second);
        assertEq(vault.totalEligibleWeight(), 0);
        assertFalse(vault.tradingEnabled());
        assertEq(vault.balanceOf(bob), shares);
    }
}

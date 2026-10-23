// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IFabxMining } from "../../../src/mining/interfaces/IFabxMining.sol";
import { SodaPolicy } from "../../../src/mining/soda/SodaPolicy.sol";
import { SodaIncentiveVault } from "../../../src/mining/soda/SodaIncentiveVault.sol";
import { SodaIgnixPool } from "../../../src/mining/soda/SodaIgnixPool.sol";
import { FabxMinerCustody } from "../../../src/mining/FabxMinerCustody.sol";

/// @dev Executes only inside Forge's local EVM fork. No signer or broadcast path.
contract SodaFormalForkTest is Test {
    IERC20 private constant FAB = IERC20(0x72F349B1Eee7833B26f8C81a8410775A4e231ed2);
    IFabxMining private constant MINING = IFabxMining(0x4F6A2312D80753BdAFd35DDB1Bf4BB14C43F8265);
    IERC721 private constant NFT = IERC721(0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6);
    address private constant ORIGIN = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address private constant REGISTRY = 0x82935793a854fA2F2e8A9d2B3F17BbfBf81D6C05;
    address private constant TREASURY = 0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A;
    uint256 private constant BLOCK = 73957111;
    SodaPolicy private policy;
    SodaIncentiveVault private vault;
    SodaIgnixPool private pool;
    address private alice;
    address private bob;

    function setUp() public {
        vm.createSelectFork(vm.envString("SODA_FORMAL_FORK_RPC"), BLOCK);
        assertEq(block.chainid, 196);
        alice = makeAddr("formal alice");
        bob = makeAddr("formal bob");
        policy = new SodaPolicy(TREASURY, TREASURY, FAB);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        vault = new SodaIncentiveVault(FAB, MINING, NFT, ORIGIN, 8, policy, predicted);
        pool = new SodaIgnixPool(vault, TREASURY);
        assertEq(address(pool), predicted);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function deposit(uint256 id, address user) private {
        address oldOwner = NFT.ownerOf(id);
        vm.prank(oldOwner);
        NFT.transferFrom(oldOwner, user, id);
        vm.startPrank(user);
        NFT.approve(address(vault), id);
        vault.deposit(id, 1);
        vm.stopPrank();
    }

    function accrue() private {
        vm.warp(block.timestamp + 600);
        vm.roll(block.number + 600);
    }

    function test_formalMiningLiquiditySwapsSplitsClaimsAndRedemption() public {
        (bool hasCounter,) = address(MINING)
            .staticcall(
                abi.encodeWithSignature(
                    "paidTo(bytes32,address)", vault.minerKey(1), address(vault)
                )
            );
        assertFalse(hasCounter);
        deposit(1, alice);
        deposit(2, bob);
        assertEq(vault.totalSupply(), 36000 ether);
        assertEq(NFT.ownerOf(1), address(vault));
        vm.startPrank(alice);
        vault.approve(address(pool), type(uint256).max);
        pool.addLiquidity{ value: 1 ether }(9000 ether, 0, 0, block.timestamp);
        vm.stopPrank();
        accrue();
        MINING.claim(vault.minerKey(1)); // unrelated caller can trigger payment to NFT owner
        uint256 externalReceipt = FAB.balanceOf(address(vault));
        assertGt(externalReceipt, 0);
        pool.harvest();
        uint256 received = vault.cumulativeMiningFab();
        assertGe(received, externalReceipt);
        assertEq(policy.fabOwed(TREASURY), received * 1000 / 10000);
        assertEq(pool.REWARDS().cumulativeIncentiveFab(), received * 500 / 10000);
        pool.harvest();
        assertEq(vault.cumulativeMiningFab(), received);
        uint256 beforeClaim = FAB.balanceOf(alice);
        (uint256 lpFab,) = pool.REWARDS().claimable(alice);
        pool.REWARDS().claimFabFor(alice);
        assertEq(FAB.balanceOf(alice) - beforeClaim, lpFab);
        assertGt(lpFab, 0);

        (uint256 out, uint256 platform, uint256 lpFee) = pool.quote(false, 0.01 ether);
        uint256 fee = 0.01 ether * 50 / 10000;
        assertEq(platform, fee * 3000 / 10000);
        assertEq(platform + lpFee, fee);
        vm.prank(bob);
        pool.swap{ value: 0.01 ether }(false, 0.01 ether, out, block.timestamp);
        assertEq(pool.INCOME().cumulativePlatformOkb(), platform);
        vm.startPrank(bob);
        vault.approve(address(pool), out);
        (uint256 okbOut,,) = pool.quote(true, out);
        pool.swap(true, out, okbOut, block.timestamp);
        vm.stopPrank();
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, block.timestamp);
        assertEq(address(pool).balance, 0);
        assertEq(vault.balanceOf(address(pool)), 0);
        (uint256 required, uint256 productFee) = vault.previewRedeem(1);
        assertEq(required, 18000 ether);
        assertEq(productFee, 18 * 1e12);
        vm.prank(alice);
        vault.redeem{ value: productFee }(1, required);
        assertEq(NFT.ownerOf(1), alice);
        assertEq(vault.totalSupply(), 18000 ether);
        (uint256 debt,) = vault.rewardLiabilities();
        assertEq(FAB.balanceOf(address(vault)), debt);
        uint256 treasuryBefore = FAB.balanceOf(TREASURY);
        uint256 owed = policy.fabOwed(TREASURY);
        policy.claimFor(TREASURY);
        assertEq(FAB.balanceOf(TREASURY) - treasuryBefore, owed);
    }

    function test_registryFactoryCannotReplaceNftOriginFactory() public {
        vm.expectRevert(FabxMinerCustody.InvalidMiningBinding.selector);
        new SodaIncentiveVault(FAB, MINING, NFT, REGISTRY, 8, policy, address(pool));
    }

    function test_unverifiedFormalMinerIsRejectedWithoutTakingCustody() public {
        address owner = NFT.ownerOf(11);
        vm.prank(owner);
        NFT.transferFrom(owner, alice, 11);
        vm.startPrank(alice);
        NFT.approve(address(vault), 11);
        vm.expectRevert(FabxMinerCustody.IneligibleMiner.selector);
        vault.deposit(11, 1);
        vm.stopPrank();
        assertEq(NFT.ownerOf(11), alice);
        assertEq(vault.totalSupply(), 0);
    }
}

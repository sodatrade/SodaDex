// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {PodMining} from "fabx/src/pod/PodMining.sol";
import {Circuits} from "fabx/src/Circuits.sol";
import {CircuitMarket} from "fabx/src/market/CircuitMarket.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Local instrumentation only, not a production or fragmentation vault implementation.
contract TestMinerCustody {
    PodMining private immutable mining;
    Circuits private immutable circuits;
    CircuitMarket private immutable market;

    constructor(PodMining mining_, Circuits circuits_, CircuitMarket market_) {
        mining = mining_;
        circuits = circuits_;
        market = market_;
    }

    function depositAfterOldOwnerClaim(uint256 id) external {
        require(circuits.ownerOf(id) == msg.sender, "not owner");
        mining.claim(mining.minerKey(address(circuits), id));
        circuits.safeTransferFrom(msg.sender, address(this), id);
    }

    function buy(uint256 listing, uint96 price) external payable {
        market.buy{value: msg.value}(listing, price);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(keccak256("onERC721Received(address,address,uint256,bytes)"));
    }
}

/// @dev Uses actual pinned FABX source, including a locally deployed FAB/mining/NFT/market.
///      The inherited MockBem serves only the boost fixture, not a BEM-mining integration.
contract FabxDependenciesRehearsalTest is OkbBoostBase {
    CircuitMarket private market;
    TestMinerCustody private custody;
    uint32 private task;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        task = _addNotTask();
        _startVerified(alice, _tape(alice), task);
        CircuitMarket implementation = new CircuitMarket();
        market = CircuitMarket(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(CircuitMarket.initialize, (owner, circuits.factory(), treasury, 0))
                )
            )
        );
        custody = new TestMinerCustody(pod, circuits, market);
        vm.deal(address(this), 1 ether);
    }

    function _ordinary() private returns (uint256 id, bytes32 key) {
        id = _tape(bob);
        key = _startVerified(bob, id, task);
    }

    function test_verifiedOrdinaryMinerHasRealFabOutputAndNoOptimalPremium() public {
        (uint256 id, bytes32 key) = _ordinary();
        PodMining.Miner memory miner = pod.getMiner(key);
        assertEq(block.chainid, 1952);
        assertEq(pod.token(), address(xmake));
        assertEq(xmake.decimals(), 8);
        assertEq(pod.processorMultiplier(address(circuits)), 6);
        assertEq(circuits.ownerOf(id), bob);
        assertEq(miner.status, 1);
        assertEq(miner.taskId, task);
        assertFalse(miner.optimal);
        assertEq(miner.bonus, 0);
        assertGt(miner.verifWeight, 0);
        assertEq(miner.unverWeight, 0);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        pod.claim(key);
        assertGt(xmake.balanceOf(bob), 0);
    }

    function test_atomicClaimBeforeCustodyTransferKeepsOldRewardWithDepositor() public {
        (uint256 id, bytes32 key) = _ordinary();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.startPrank(bob);
        circuits.approve(address(custody), id);
        custody.depositAfterOldOwnerClaim(id);
        vm.stopPrank();
        uint256 oldOwnerReward = xmake.balanceOf(bob);
        assertGt(oldOwnerReward, 0);
        assertEq(xmake.balanceOf(address(custody)), 0);
        assertEq(circuits.ownerOf(id), address(custody));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        pod.claim(key);
        assertGt(xmake.balanceOf(address(custody)), 0);
        assertEq(xmake.balanceOf(bob), oldOwnerReward);
    }

    function test_marketPurchaseUsesNativeOkbAndUnclaimedFabFollowsNft() public {
        (uint256 id, bytes32 key) = _ordinary();
        uint96 price = 0.0001 ether;
        vm.startPrank(bob);
        circuits.approve(address(market), id);
        uint256 listing = market.list(address(circuits), id, price);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        uint256 sellerBalance = bob.balance;
        custody.buy{value: price}(listing, price);
        assertEq(circuits.ownerOf(id), address(custody));
        assertEq(bob.balance, sellerBalance + price);
        assertEq(xmake.balanceOf(bob), 0);
        pod.claim(key);
        assertGt(xmake.balanceOf(address(custody)), 0);
        assertEq(xmake.balanceOf(bob), 0);
    }

    function test_fabApprovalCannotReplaceNativeMarketPayment() public {
        (uint256 id,) = _ordinary();
        uint96 price = 0.0001 ether;
        vm.startPrank(bob);
        circuits.approve(address(market), id);
        uint256 listing = market.list(address(circuits), id, price);
        vm.stopPrank();
        vm.prank(owner);
        xmake.transfer(address(this), 1e8);
        xmake.approve(address(market), 1e8);
        vm.expectRevert("wrong value");
        market.buy(listing, price);
        assertEq(circuits.ownerOf(id), bob);
        assertEq(xmake.balanceOf(address(this)), 1e8);
    }

    function test_pausedClaimsStillAllowExactPendingCheckpoint() public {
        (, bytes32 key) = _ordinary();
        vm.prank(owner);
        pod.pause();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        // poke is deliberately independent of the claim pause in the real source.
        pod.poke();
        uint256 pending = pod.pending(key);
        assertGt(pending, 0);
        vm.expectRevert(bytes4(keccak256("EnforcedPause()")));
        pod.claim(key);
        assertEq(pod.pending(key), pending);
        assertEq(xmake.balanceOf(bob), 0);
        vm.prank(owner);
        pod.unpause();
        pod.claim(key);
        assertEq(xmake.balanceOf(bob), pending);
    }

    function test_supplyCapCanClipUnclaimedPendingAndAdvanceItsDebt() public {
        (, bytes32 first) = _ordinary();
        (, bytes32 second) = _ordinary();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        pod.poke();
        assertGt(pod.pending(first), 10);
        assertGt(pod.pending(second), 10);
        // Fixture-only cap positioning: no live mint or production authority is used.
        uint256 fill = xmake.MAX_SUPPLY() - xmake.totalSupply() - 10;
        vm.prank(address(pod));
        xmake.mint(owner, fill);
        assertGt(pod.pending(first) + pod.pending(second), xmake.remainingSupply());
        pod.claim(first);
        assertEq(xmake.balanceOf(bob), 10);
        assertEq(pod.pending(first), 0);
        assertGt(pod.pending(second), 10);
        pod.claim(second);
        assertEq(xmake.balanceOf(bob), 10);
        assertEq(pod.pending(second), 0);
        assertEq(xmake.remainingSupply(), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {PodMining} from "fabx/src/pod/PodMining.sol";
import {PodToken} from "fabx/src/pod/PodToken.sol";
import {Circuits} from "fabx/src/Circuits.sol";
import {IPaidMiningRewards} from "./FabxPaidRewards.t.sol";

contract PaidRewardsHandler is Test {
    PodMining public immutable mining;
    PodToken public immutable fab;
    Circuits public immutable nft;
    bytes32 public immutable key;
    uint256 public immutable id;
    address public immutable first;
    address public immutable second;
    address private immutable donor;
    mapping(address => uint256) public donations;

    constructor(PodMining p, PodToken f, Circuits c, bytes32 k, uint256 tokenId, address a, address b, address d) {
        mining = p;
        fab = f;
        nft = c;
        key = k;
        id = tokenId;
        first = a;
        second = b;
        donor = d;
    }

    function claim(uint32 elapsed) external {
        vm.warp(vm.getBlockTimestamp() + bound(elapsed, 1, 1 days));
        mining.claim(key);
    }

    function transfer(bool toFirst) external {
        address current = nft.ownerOf(id);
        vm.prank(current);
        nft.transferFrom(current, toFirst ? first : second, id);
    }

    function donate(uint128 amount, bool toFirst) external {
        uint256 available = fab.balanceOf(donor);
        if (available == 0) return;
        uint256 value = bound(amount, 1, available);
        address recipient = toFirst ? first : second;
        vm.prank(donor);
        assertTrue(fab.transfer(recipient, value));
        donations[recipient] += value;
    }

    function forgePayout(uint128 amount) external {
        (bool ok,) = address(mining)
            .call(
                abi.encodeWithSignature(
                    "prepareHarvest(bytes32,uint256,address,address,uint256)",
                    key,
                    amount,
                    address(fab),
                    address(nft),
                    id
                )
            );
        assertFalse(ok);
    }
}

contract FabxPaidRewardsInvariantTest is OkbBoostBase {
    PaidRewardsHandler private handler;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        uint32 task = _addNotTask();
        _startVerified(alice, _tape(alice), task);
        uint256 id = _tape(bob);
        bytes32 key = _startVerified(bob, id, task);
        handler = new PaidRewardsHandler(pod, xmake, circuits, key, id, bob, alice, owner);
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.claim.selector;
        selectors[1] = handler.transfer.selector;
        selectors[2] = handler.donate.selector;
        selectors[3] = handler.forgePayout.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_actualPaidCountersMatchMintedBalancesWithoutDonations() public view {
        IPaidMiningRewards rewards = IPaidMiningRewards(address(pod));
        assertEq(rewards.paidTo(handler.key(), bob) + handler.donations(bob), xmake.balanceOf(bob));
        assertEq(rewards.paidTo(handler.key(), alice) + handler.donations(alice), xmake.balanceOf(alice));
    }
}

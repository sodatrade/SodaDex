// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { RewardLedger } from "../../../src/mining/soda/RewardLedger.sol";

contract LedgerHarness {
    using RewardLedger for RewardLedger.Book;
    RewardLedger.Book private book;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    function accrue(uint256 amount) external {
        book.accrue(amount, totalSupply);
    }

    function move(address from, address to, uint256 amount) external {
        book.move(
            from, from == address(0) ? 0 : balanceOf[from], to, to == address(0) ? 0 : balanceOf[to]
        );
        if (from == address(0)) totalSupply += amount;
        else balanceOf[from] -= amount;
        if (to == address(0)) totalSupply -= amount;
        else balanceOf[to] += amount;
    }

    function claimable(address who) external view returns (uint256) {
        return book.claimable(who, balanceOf[who]);
    }

    function take(address who) external returns (uint256) {
        return book.take(who, balanceOf[who]);
    }
}

/// A tiny early supply drives `points` very high; later normal-size LP moves must still work and
/// old income must stay with its owner (Codex review of e23205f19, P1).
contract RewardLedgerTest is Test {
    LedgerHarness ledger = new LedgerHarness();
    address dust = makeAddr("dust");
    address lp = makeAddr("lp");
    address buyer = makeAddr("buyer");

    function test_tinySupplyHistoryDoesNotBlockLaterMoves() public {
        ledger.move(address(0), dust, 1); // one wei of LP
        ledger.accrue(1_000 ether); // fees on a 1-wei supply
        assertEq(ledger.take(dust), 1_000 ether);
        ledger.move(dust, address(0), 1); // dust leaves

        ledger.move(address(0), lp, 1e30); // a normal (large) position after it
        assertEq(ledger.claimable(lp), 0, "no old income for the newcomer");
        ledger.accrue(5 ether);
        ledger.move(lp, buyer, 4e29);
        ledger.accrue(5 ether);
        assertApproxEqAbs(ledger.claimable(lp), 5 ether + 3 ether, 2);
        assertApproxEqAbs(ledger.claimable(buyer), 2 ether, 2);
        ledger.move(lp, address(0), 6e29);
        assertApproxEqAbs(ledger.take(lp), 8 ether, 2, "kept after leaving");
    }

    function testFuzz_neverOverpays(uint96 a, uint96 b, uint64 fee1, uint64 fee2) public {
        vm.assume(a > 0 && b > 0);
        ledger.move(address(0), lp, a);
        ledger.accrue(fee1);
        ledger.move(address(0), buyer, b);
        ledger.accrue(fee2);
        ledger.move(lp, buyer, a / 2);
        assertLe(ledger.take(lp) + ledger.take(buyer), uint256(fee1) + fee2);
    }

    /// Review R5: settling every round must not round income away.
    function test_frequentSettlesKeepTheRemainder() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        ledger.move(address(0), alice, 1);
        ledger.move(address(0), bob, 1);
        uint256 taken;
        for (uint256 i; i < 100; ++i) {
            ledger.accrue(1);
            taken += ledger.take(alice);
        }
        assertEq(taken, 50, "same as claiming once at the end");
    }
}

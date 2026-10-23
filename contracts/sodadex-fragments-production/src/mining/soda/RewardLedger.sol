// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Historical rewards stay with their owner on mint, burn and transfer.
///      Each account is settled (owed += balance × Δpoints) before its balance changes, so nothing
///      stores `points × amount`: a tiny early supply that drove `points` high can no longer make
///      later normal-size moves overflow.
library RewardLedger {
    uint256 private constant SCALE = 1 << 128;

    struct Book {
        uint256 points;
        uint256 reserved;
        uint256 parked;
        mapping(address => uint256) last;
        mapping(address => uint256) owed;
    }

    function accrue(Book storage b, uint256 amount, uint256 supply) internal {
        b.reserved += amount;
        if (supply == 0) b.parked += amount;
        else b.points += Math.mulDiv(amount, SCALE, supply);
    }

    /// @dev Settle both sides at their balances before the change; call before updating balances.
    function move(
        Book storage b,
        address from,
        uint256 fromBalance,
        address to,
        uint256 toBalance
    ) internal {
        if (from != address(0)) settle(b, from, fromBalance);
        if (to != address(0)) settle(b, to, toBalance);
    }

    function settle(Book storage b, address account, uint256 balance) internal {
        b.owed[account] = claimable(b, account, balance);
        b.last[account] = b.points;
    }

    function claimable(Book storage b, address account, uint256 balance)
        internal
        view
        returns (uint256)
    {
        return b.owed[account] + Math.mulDiv(balance, b.points - b.last[account], SCALE);
    }

    function take(Book storage b, address account, uint256 balance)
        internal
        returns (uint256 amount)
    {
        amount = claimable(b, account, balance);
        b.owed[account] = 0;
        b.last[account] = b.points;
        b.reserved -= amount;
    }
}

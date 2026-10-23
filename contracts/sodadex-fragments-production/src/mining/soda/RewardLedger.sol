// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @dev Historical rewards stay with their owner on mint, burn and transfer.
library RewardLedger {
    using SafeCast for uint256;
    uint256 private constant SCALE = 1 << 128;

    struct Book {
        uint256 points;
        uint256 reserved;
        uint256 parked;
        mapping(address => int256) correction;
        mapping(address => uint256) paid;
    }

    function accrue(Book storage b, uint256 amount, uint256 supply) internal {
        b.reserved += amount;
        if (supply == 0) b.parked += amount;
        else b.points += Math.mulDiv(amount, SCALE, supply);
    }

    function move(Book storage b, address from, address to, uint256 amount) internal {
        int256 correction = (b.points * amount).toInt256();
        if (from != address(0)) b.correction[from] += correction;
        if (to != address(0)) b.correction[to] -= correction;
    }

    function claimable(Book storage b, address account, uint256 balance)
        internal
        view
        returns (uint256)
    {
        return SafeCast.toUint256((b.points * balance).toInt256() + b.correction[account]) / SCALE
            - b.paid[account];
    }

    function take(Book storage b, address account, uint256 balance)
        internal
        returns (uint256 amount)
    {
        amount = claimable(b, account, balance);
        b.paid[account] += amount;
        b.reserved -= amount;
    }
}

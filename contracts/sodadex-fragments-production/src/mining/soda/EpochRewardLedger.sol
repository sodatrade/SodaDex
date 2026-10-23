// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Funded epochs, cumulative confirmed points and at most two unconfirmed holder slots.
/// All rounding is down. Unallocated funds and rounding dust stay reserved, never become principal.
library EpochRewardLedger {
    uint256 internal constant SCALE = 1e36;

    struct Epoch {
        uint256 end;
        uint256 raw;
        uint256 eligible;
        uint256 funded;
        uint256 cumulative;
    }

    struct Slot {
        uint64 epoch;
        uint256 raw;
        uint256 fraction;
    }

    struct Account {
        uint64 epoch;
        uint256 points;
        uint256 owed;
        Slot first;
        Slot second;
    }

    struct Book {
        uint64 open;
        uint64 confirmed;
        uint256 points;
        uint256 reserved;
        uint256 parked;
        mapping(uint64 => Epoch) epochs;
        mapping(address => Account) accounts;
    }
    error EpochOrder();
    error PendingSlotsFull();

    function initialize(Book storage b) internal {
        b.open = 1;
    }

    function accrue(Book storage b, uint256 raw, uint256 supply) internal {
        b.epochs[b.open].raw += raw;
        if (supply != 0) {
            b.epochs[b.open].eligible += raw;
            b.points += Math.mulDiv(raw, SCALE, supply);
        }
    }

    function close(Book storage b, uint64 epoch) internal {
        if (epoch != b.open || epoch != b.confirmed + 1) revert EpochOrder();
        b.epochs[epoch].end = b.points;
        b.open = epoch + 1;
    }

    function fund(Book storage b, uint64 epoch, uint256 amount) internal {
        if (epoch != b.confirmed + 1 || epoch >= b.open) revert EpochOrder();
        Epoch storage e = b.epochs[epoch];
        e.funded = amount;
        b.reserved += amount;
        b.parked += e.raw == 0 ? amount : Math.mulDiv(amount, e.raw - e.eligible, e.raw);
        e.cumulative = b.epochs[epoch - 1].cumulative
            + (e.raw == 0 ? 0 : Math.mulDiv(e.end - b.epochs[epoch - 1].end, amount, e.raw));
        b.confirmed = epoch;
    }

    function _value(Book storage b, uint64 epoch, uint256 raw, uint256 fraction) private view returns (uint256) {
        Epoch storage e = b.epochs[epoch];
        if (e.raw == 0) return 0;
        uint256 whole = Math.mulDiv(raw, e.funded, e.raw);
        uint256 remainder = mulmod(raw, e.funded, e.raw);
        // Keep fractional weight until payout. Split the product to avoid raw * SCALE overflow.
        uint256 fractionalProduct = Math.mulDiv(fraction, e.funded, SCALE);
        uint256 extra = fractionalProduct / e.raw;
        uint256 extraRemainder = fractionalProduct % e.raw;
        return whole + extra + (remainder >= e.raw - extraRemainder ? 1 : 0);
    }

    function _book(Book storage b, Account memory a, uint64 epoch, uint256 balance, uint256 delta) private view {
        uint256 raw = Math.mulDiv(balance, delta, SCALE);
        uint256 fraction = mulmod(balance, delta, SCALE);
        if (raw == 0 && fraction == 0) return;
        if (epoch <= b.confirmed) {
            a.owed += _value(b, epoch, raw, fraction);
        } else {
            Slot memory slot;
            bool first;
            if (a.first.epoch == epoch) {
                slot = a.first;
                first = true;
            } else if (a.second.epoch == epoch) {
                slot = a.second;
            } else if (a.first.epoch == 0) {
                slot.epoch = epoch;
                first = true;
            } else if (a.second.epoch == 0) {
                slot.epoch = epoch;
            } else {
                revert PendingSlotsFull();
            }
            uint256 combinedFraction = slot.fraction + fraction;
            slot.raw += raw + combinedFraction / SCALE;
            slot.fraction = combinedFraction % SCALE;
            if (first) a.first = slot;
            else a.second = slot;
        }
    }

    function settled(Book storage b, address who, uint256 balance) internal view returns (Account memory a) {
        a = b.accounts[who];
        if (a.first.epoch != 0 && a.first.epoch <= b.confirmed) {
            a.owed += _value(b, a.first.epoch, a.first.raw, a.first.fraction);
            a.first = Slot(0, 0, 0);
        }
        if (a.second.epoch != 0 && a.second.epoch <= b.confirmed) {
            a.owed += _value(b, a.second.epoch, a.second.raw, a.second.fraction);
            a.second = Slot(0, 0, 0);
        }
        uint64 start = a.epoch;
        if (start != 0 && balance != 0) {
            if (start == b.open) {
                _book(b, a, start, balance, b.points - a.points);
            } else {
                _book(b, a, start, balance, b.epochs[start].end - a.points);
                uint64 last = b.open - 1;
                uint64 k = b.confirmed;
                if (k > start) {
                    a.owed += Math.mulDiv(balance, b.epochs[k].cumulative - b.epochs[start].cumulative, SCALE);
                }
                if (last > k && last > start) {
                    _book(b, a, last, balance, b.epochs[last].end - b.epochs[last - 1].end);
                }
                _book(b, a, b.open, balance, b.points - b.epochs[last].end);
            }
        }
        a.epoch = b.open;
        a.points = b.points;
    }

    function settle(Book storage b, address who, uint256 balance) internal {
        b.accounts[who] = settled(b, who, balance);
    }

    function take(Book storage b, address who, uint256 balance) internal returns (uint256 amount) {
        Account memory a = settled(b, who, balance);
        amount = a.owed;
        a.owed = 0;
        b.accounts[who] = a;
        b.reserved -= amount;
    }
}

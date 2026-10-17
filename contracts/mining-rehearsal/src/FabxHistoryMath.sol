// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Exact pinned FABX interval arithmetic for the planned 1952 history extension.
/// This pure library does not enable source history or burn credits by itself.
library FabxHistoryMath {
    uint256 internal constant ACC = 1e27;
    uint256 internal constant RATE = uint256(50 * 1e8) / 600;
    uint256 internal constant HALVING = 210_000 * 600;

    struct Interval {
        uint64 start;
        uint64 from;
        uint64 to;
        uint64 until;
        uint256[2] baseline;
        uint256[2] raw;
        uint256[2] baseBefore;
        uint256[2] extraBefore;
    }

    error InvalidHistory();

    function emission(uint256 start, uint256 from, uint256 to) internal pure returns (uint256 amount) {
        if (to <= start || to <= from) return 0;
        if (from < start) from = start;
        uint256 first = (from - start) / HALVING;
        if (first > 63) return 0;
        uint256 last = (to - start) / HALVING;
        if (last > 63) { last = 63; to = start + 64 * HALVING; }
        for (uint256 era = first; era <= last; ++era) {
            uint256 a = era == first ? from : start + era * HALVING;
            uint256 b = era == last ? to : start + (era + 1) * HALVING;
            if (b > a) amount += (b - a) * (RATE >> era);
        }
    }

    function accumulatorsAt(Interval memory r, uint256 timestamp)
        internal pure returns (uint256[2] memory base, uint256[2] memory extra)
    {
        // Memory array assignment aliases the record; prefix queries must leave it intact.
        for (uint256 i; i < 2; ++i) {
            base[i] = r.baseBefore[i];
            extra[i] = r.extraBefore[i];
        }
        if (r.to < r.from) revert InvalidHistory();
        if (timestamp <= r.from) return (base, extra);
        if (timestamp > r.to) timestamp = r.to;
        uint256 last = r.from;
        uint256 split = r.until != 0 && r.until < timestamp ? r.until : timestamp;
        if (r.until != 0 && last < split) {
            (uint256[2] memory b, uint256[2] memory e) = _deltas(emission(r.start, last, split), r.baseline, r.raw);
            for (uint256 i; i < 2; ++i) { base[i] += b[i]; extra[i] += e[i]; }
            last = split;
        }
        if (last < timestamp) {
            uint256[2] memory zero;
            (uint256[2] memory b,) = _deltas(emission(r.start, last, timestamp), r.baseline, zero);
            for (uint256 i; i < 2; ++i) base[i] += b[i];
        }
    }

    /// @dev Prefix differences telescope: adding an expiry cut never loses or creates paid units.
    function paidPrefix(uint256 paid, uint256 gross, uint256 prefix) internal pure returns (uint256) {
        if (paid > gross || prefix > gross) revert InvalidHistory();
        if (gross == 0) return 0;
        return Math.mulDiv(paid, prefix, gross);
    }

    function baselinePrefix(uint256 verifWeight, uint256 unverWeight, uint256 debt,
        uint256[2] memory indices, uint256 totalBaseline) internal pure returns (uint256)
    {
        uint256 earned = Math.mulDiv(verifWeight, indices[0], ACC) + Math.mulDiv(unverWeight, indices[1], ACC);
        return Math.min(earned > debt ? earned - debt : 0, totalBaseline);
    }

    function _deltas(uint256 amount, uint256[2] memory baseline, uint256[2] memory raw)
        private pure returns (uint256[2] memory base, uint256[2] memory extra)
    {
        uint256 unverified = amount * 100 / 10_000;
        (base[0], extra[0]) = _segment(amount - unverified, baseline[0], raw[0]);
        (base[1], extra[1]) = _segment(unverified, baseline[1], raw[1]);
    }

    function _segment(uint256 reward, uint256 baseline, uint256 raw)
        private pure returns (uint256 base, uint256 extra)
    {
        if (baseline == 0) return (0, 0);
        uint256 addition = Math.min(raw, baseline / 20);
        base = reward * ACC / (baseline + addition);
        if (raw != 0) extra = base * addition / raw;
    }
}

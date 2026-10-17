// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FabxHistoryMath as Integral} from "./FabxHistoryMath.sol";

interface IFabxHistoryCore {
    struct Miner {
        address circuits; uint64 circuitId; uint32 taskId; uint32 gateCount; uint32 stateCount;
        uint32 depth; uint64 area; uint32 mult; uint64 since; uint8 status; address registrant;
        uint32 nandBurn; uint32 latchBurn; uint64 bstar; uint64 bonus; bool optimal;
        uint64 commitBlock; uint64 firstUnusedId; uint64 stopBlock; uint128 verifWeight;
        uint128 unverWeight; uint256 debt; uint32 boostBps;
    }
    function accVerif() external view returns (uint256);
    function accUnver() external view returns (uint256);
    function getMiner(bytes32 key) external view returns (Miner memory);
}

/// @dev Namespaced, append-only history for the 1952 source variant. No core slots.
/// Libraries execute in the mining proxy; none of these mutating methods is a fallback entry.
library FabxRewardHistory {
    uint256 private constant ACC = 1e27;
    bytes32 private constant SLOT = keccak256("sodadex.test.fabx.reward.history.v2");

    struct Period {
        Integral.Interval integral;
        uint64 epoch;
    }

    struct ExtraPiece {
        uint64 epoch;
        uint64 end;
        uint8 pool;
        uint256 raw;
        uint256 debt;
        uint256 endpoint;
        uint256 cumulativeGross;
    }

    struct Receipt {
        uint64 at;
        uint256 paid;
        uint256 cumulativePaid;
        uint256 gross;
        uint256 baseline;
        uint256 verified;
        uint256 unverified;
        uint256 debt;
        uint256 pieceFrom;
        uint256 pieceTo;
        bool complete;
    }

    struct State {
        Period[] periods;
        mapping(uint64 => uint64) epochUntil;
        mapping(bytes32 => ExtraPiece[]) pieces;
        mapping(bytes32 => uint256) consumed;
        mapping(bytes32 => mapping(address => Receipt[])) receipts;
    }

    error InvalidHistory();
    error IncompleteHistory();

    function state() private pure returns (State storage s) {
        bytes32 slot = SLOT;
        assembly { s.slot := slot }
    }

    function recordPeriod(Integral.Interval memory integral, uint64 epoch) public {
        if (integral.to <= integral.from) return;
        State storage s = state();
        uint256 count = s.periods.length;
        if (count != 0 && s.periods[count - 1].integral.to > integral.from) revert InvalidHistory();
        s.periods.push(Period(integral, epoch));
        if (integral.until != 0) s.epochUntil[epoch] = integral.until;
    }

    function checkpoint(uint64 start, uint64 last, uint256[2] memory baseline, uint64 epoch,
        uint64 until, uint256[2] memory raw, uint256[2] memory extra) public
    {
        IFabxHistoryCore core = IFabxHistoryCore(address(this));
        recordPeriod(Integral.Interval(start, last, uint64(block.timestamp), until, baseline, raw,
            [core.accVerif(), core.accUnver()], extra), epoch);
    }

    function recordExtra(bytes32 key, uint64 epoch, uint8 pool, uint256 raw, uint256 debt, uint256 endpoint)
        public
    {
        uint256 earned = Math.mulDiv(raw, endpoint, ACC);
        if (earned <= debt) return;
        State storage s = state();
        ExtraPiece[] storage pieces = s.pieces[key];
        uint256 previous = pieces.length == 0 ? 0 : pieces[pieces.length - 1].cumulativeGross;
        uint64 until = s.epochUntil[epoch];
        // An old epoch may already be over when its credit is settled lazily.
        uint64 end = until != 0 && until < block.timestamp ? until : uint64(block.timestamp);
        pieces.push(ExtraPiece(epoch, end, pool, raw, debt, endpoint, previous + earned - debt));
    }

    /// @dev Consumes extra pieces even when the cap leaves no minting room.
    function recordReceipt(bytes32 key, address recipient, uint256 paid, uint256 baseline,
        uint256 extra, uint256 verified, uint256 unverified, uint256 debt) public
    {
        State storage s = state();
        uint256 first = s.consumed[key];
        uint256 last = s.pieces[key].length;
        s.consumed[key] = last;
        if (paid == 0) return;
        uint256 gross = baseline + extra;
        if (paid > gross || recipient == address(0)) revert InvalidHistory();
        Receipt[] storage receipts = s.receipts[key][recipient];
        uint256 previous = receipts.length == 0 ? 0 : receipts[receipts.length - 1].cumulativePaid;
        bool complete = _pieceSum(s.pieces[key], first, last) == extra;
        receipts.push(Receipt(uint64(block.timestamp), paid, previous + paid, gross, baseline,
            verified, unverified, debt, first, last, complete));
    }

    function recordHarvest(bytes32 key, address recipient, uint256 paid, uint256 baseline, uint256 extra)
        public
    {
        IFabxHistoryCore.Miner memory m = IFabxHistoryCore(address(this)).getMiner(key);
        recordReceipt(key, recipient, paid, baseline, extra, m.verifWeight, m.unverWeight, m.debt - baseline);
    }

    function receiptCount(bytes32 key, address recipient) public view returns (uint256) {
        return state().receipts[key][recipient].length;
    }

    function receipt(bytes32 key, address recipient, uint256 index) public view returns (Receipt memory) {
        return state().receipts[key][recipient][index];
    }

    function periodCount() public view returns (uint256) { return state().periods.length; }

    /// @notice Actual paid income in a frozen receipt range earned through timestamp.
    /// Fully completed receipts plus at most one partial receipt: logarithmic history reads.
    function paidThrough(bytes32 key, address recipient, uint256 first, uint256 last, uint256 timestamp)
        public view returns (uint256 amount)
    {
        State storage s = state();
        Receipt[] storage receipts = s.receipts[key][recipient];
        if (last > receipts.length || first > last) revert InvalidHistory();
        if (first == last) return 0;
        uint256 low = first;
        uint256 high = last;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (receipts[mid].at <= timestamp) low = mid + 1;
            else high = mid;
        }
        if (low > first) amount = receipts[low - 1].cumulativePaid
            - (first == 0 ? 0 : receipts[first - 1].cumulativePaid);
        if (low < last) {
            Receipt storage r = receipts[low];
            if (!r.complete) revert IncompleteHistory();
            (uint256[2] memory base,,) = _indicesAt(timestamp);
            uint256 grossPrefix = Integral.baselinePrefix(r.verified, r.unverified, r.debt, base, r.baseline)
                + _extraThrough(s, key, r.pieceFrom, r.pieceTo, timestamp);
            amount += Integral.paidPrefix(r.paid, r.gross, grossPrefix);
        }
    }

    function _extraThrough(State storage s, bytes32 key, uint256 first, uint256 last, uint256 timestamp)
        private view returns (uint256 amount)
    {
        if (first == last) return 0;
        ExtraPiece[] storage pieces = s.pieces[key];
        uint256 low = first;
        uint256 high = last;
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (pieces[mid].end <= timestamp) low = mid + 1;
            else high = mid;
        }
        amount = _pieceSum(pieces, first, low);
        if (low == last) return amount;
        ExtraPiece storage p = pieces[low];
        (,uint256[2] memory extra,uint64 epoch) = _indicesAt(timestamp);
        if (epoch < p.epoch) return amount;
        if (epoch != p.epoch) revert InvalidHistory();
        uint256 earned = Math.mulDiv(p.raw, Math.min(extra[p.pool], p.endpoint), ACC);
        if (earned > p.debt) amount += earned - p.debt;
    }

    function _pieceSum(ExtraPiece[] storage pieces, uint256 first, uint256 last) private view returns (uint256) {
        if (first == last) return 0;
        return pieces[last - 1].cumulativeGross - (first == 0 ? 0 : pieces[first - 1].cumulativeGross);
    }

    function _indicesAt(uint256 timestamp)
        private view returns (uint256[2] memory base, uint256[2] memory extra, uint64 epoch)
    {
        Period[] storage periods = state().periods;
        if (periods.length == 0 || timestamp < periods[0].integral.from) revert IncompleteHistory();
        uint256 low;
        uint256 high = periods.length;
        // At a shared endpoint choose the following interval: extra indices may reset.
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (periods[mid].integral.to <= timestamp) low = mid + 1;
            else high = mid;
        }
        uint256 index = low == periods.length ? low - 1 : low;
        Period storage p = periods[index];
        if (timestamp < p.integral.from) revert IncompleteHistory();
        (base, extra) = Integral.accumulatorsAt(p.integral, timestamp);
        epoch = p.epoch;
    }
}

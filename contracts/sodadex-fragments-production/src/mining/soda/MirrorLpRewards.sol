// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IgnixLpRewards} from "./IgnixLpRewards.sol";
import {RewardLedger} from "./RewardLedger.sol";
import {EpochRewardLedger} from "./EpochRewardLedger.sol";
import {IMirrorEpochRewards} from "./interfaces/IMirrorEpochVault.sol";

/// @notice New-deployment rewards for an epoch-aware vault. Legacy rewards and debts are unchanged.
contract MirrorLpRewards is IgnixLpRewards, IMirrorEpochRewards {
    using SafeERC20 for IERC20;
    using RewardLedger for RewardLedger.Book;
    using EpochRewardLedger for EpochRewardLedger.Book;

    bytes32 public constant VERSION = keccak256("SodaDEX.MirrorEpochRewards.v1");
    EpochRewardLedger.Book private _poolFab;
    EpochRewardLedger.Book private _incentives;
    uint256 public lastPoolWeight;
    uint256 public lastTimestamp;
    uint256 public lastSyncBlock;
    mapping(uint64 => uint256) public closedAt;

    error EpochMismatch();
    error StaleCheckpoint();
    error EpochFundingRequired();
    error NoHistoricalLp();
    event EpochClosed(uint64 indexed epoch, uint256 timestamp, uint256 activeTime);
    event EpochFunded(uint64 indexed epoch, uint256 poolFab, uint256 incentiveFab);

    constructor(IERC20 fab, address source) IgnixLpRewards(fab, source) {
        _poolFab.initialize();
        _incentives.initialize();
        lastTimestamp = block.timestamp;
    }

    modifier onlyVault() {
        if (msg.sender != INCENTIVE_SOURCE) revert Unauthorized();
        _;
    }

    function checkpoint(uint64 epoch, uint256 cumulativePoolWeight) external onlyVault nonReentrant {
        _sync(epoch, cumulativePoolWeight);
    }

    function _sync(uint64 epoch, uint256 cumulativePoolWeight) private {
        if (epoch != _poolFab.open || cumulativePoolWeight < lastPoolWeight) revert EpochMismatch();
        _poolFab.accrue(cumulativePoolWeight - lastPoolWeight, totalSupply);
        lastPoolWeight = cumulativePoolWeight;
        _tick();
        lastSyncBlock = block.number;
    }

    function _tick() private {
        // No-LP intervals do not dilute this epoch's incentive: all of it goes to historical LPs.
        if (totalSupply != 0) _incentives.accrue(block.timestamp - lastTimestamp, totalSupply);
        lastTimestamp = block.timestamp;
    }

    function closeEpoch(uint64 epoch, uint256 cumulativePoolWeight) external onlyVault nonReentrant {
        _sync(epoch, cumulativePoolWeight);
        _poolFab.close(epoch);
        _incentives.close(epoch);
        closedAt[epoch] = block.timestamp;
        emit EpochClosed(epoch, block.timestamp, _incentives.epochs[epoch].raw);
    }

    function activeSeconds(uint64 epoch) external view returns (uint256) {
        return _incentives.epochs[epoch].raw;
    }

    /// @notice Atomically fund both historical streams; the source must clear its matching pool debt.
    /// A zero payout still confirms an epoch. Empty-history incentives belong at the source treasury.
    function notifyEpochRewards(uint64 epoch, uint256 poolFab, uint256 incentiveFab) external onlyVault nonReentrant {
        if (incentiveFab != 0 && _incentives.epochs[epoch].raw == 0) revert NoHistoricalLp();
        uint256 amount = poolFab + incentiveFab;
        uint256 beforeBalance = FAB.balanceOf(address(this));
        if (amount != 0) FAB.safeTransferFrom(msg.sender, address(this), amount);
        if (FAB.balanceOf(address(this)) - beforeBalance != amount) revert InvalidReceivedAmount();
        _poolFab.fund(epoch, poolFab);
        _incentives.fund(epoch, incentiveFab);
        cumulativePoolFab += poolFab;
        cumulativeIncentiveFab += incentiveFab;
        emit EpochFunded(epoch, poolFab, incentiveFab);
    }

    function move(address from, address to, uint256 amount) public override onlyPool {
        if (lastSyncBlock != block.number) revert StaleCheckpoint();
        _tick();
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super.move(from, to, amount);
    }

    function _settle(address account) private {
        _poolFab.settle(account, balanceOf[account]);
        _incentives.settle(account, balanceOf[account]);
    }

    function recordFab() external pure override {
        revert EpochFundingRequired();
    }

    function notifyIncentive(uint256) external pure override {
        revert EpochFundingRequired();
    }

    function claimable(address account) external view override returns (uint256 fab, uint256 okb) {
        uint256 balance = balanceOf[account];
        fab = _poolFab.settled(account, balance).owed + _incentives.settled(account, balance).owed;
        okb = _okb.claimable(account, balance);
    }

    function rewardLiabilities() external view override returns (uint256, uint256) {
        return (_poolFab.reserved + _incentives.reserved, _okb.reserved);
    }

    function unallocatedFab() external view override returns (uint256) {
        return _poolFab.parked + _incentives.parked;
    }

    function _claimFab(address account) internal override returns (uint256 fab) {
        if (account == address(this)) revert InvalidBinding();
        uint256 balance = balanceOf[account];
        fab = _poolFab.take(account, balance) + _incentives.take(account, balance);
        if (fab != 0) FAB.safeTransfer(account, fab);
    }
}

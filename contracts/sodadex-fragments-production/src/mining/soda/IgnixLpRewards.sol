// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RewardLedger } from "./RewardLedger.sol";

/// @notice Holds LP rewards; the bound pool synchronizes ownership and the vault funds incentives.
/// @dev No admin, arbitrary recipient, principal withdrawal or replaceable pool.
contract IgnixLpRewards is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using RewardLedger for RewardLedger.Book;
    address public immutable POOL;
    IERC20 public immutable FAB;
    address public immutable INCENTIVE_SOURCE;
    uint256 public cumulativeIncentiveFab;
    uint256 public cumulativePoolFab;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;
    RewardLedger.Book private _fab;
    RewardLedger.Book internal _okb;
    error Unauthorized();
    error TransferFailed();
    error InvalidBinding();
    error EmptyAmount();
    error InvalidReceivedAmount();
    event RewardsClaimed(address indexed account, uint256 fab, uint256 okb);
    event IncentiveRecorded(
        address indexed source, uint256 amount, uint256 lpSupply, uint256 cumulativeAmount
    );
    event PoolFabRecorded(uint256 amount, uint256 lpSupply, uint256 cumulativeAmount);

    constructor(IERC20 fab, address incentiveSource) {
        if (address(fab).code.length == 0 || incentiveSource.code.length == 0) {
            revert InvalidBinding();
        }
        POOL = msg.sender;
        FAB = fab;
        INCENTIVE_SOURCE = incentiveSource;
    }
    modifier onlyPool() {
        if (msg.sender != POOL) revert Unauthorized();
        _;
    }

    /// @dev Called before LP mint/burn/transfer; existing income remains with the old holder.
    function move(address from, address to, uint256 amount) public virtual onlyPool nonReentrant {
        _fab.move(from, to, amount);
        _okb.move(from, to, amount);
        if (from == address(0)) totalSupply += amount;
        else balanceOf[from] -= amount;
        if (to == address(0)) totalSupply -= amount;
        else balanceOf[to] += amount;
    }

    function recordFab() external virtual onlyPool nonReentrant {
        uint256 amount = FAB.balanceOf(address(this)) - _fab.reserved;
        if (amount == 0) return;
        _fab.accrue(amount, totalSupply);
        cumulativePoolFab += amount;
        emit PoolFabRecorded(amount, totalSupply, cumulativePoolFab);
    }

    function recordOkb() external payable onlyPool nonReentrant {
        _okb.accrue(msg.value, totalSupply);
    }

    /// @notice The bound vault approves this contract, then atomically funds and records FAB.
    /// @dev The vault must settle pending incentives before the pool changes any LP balance.
    /// Zero-supply income stays reserved but cannot be claimed by future LPs.
    function notifyIncentive(uint256 amount) external virtual nonReentrant {
        if (msg.sender != INCENTIVE_SOURCE) revert Unauthorized();
        if (amount == 0) revert EmptyAmount();
        uint256 before_ = FAB.balanceOf(address(this));
        FAB.safeTransferFrom(msg.sender, address(this), amount);
        uint256 after_ = FAB.balanceOf(address(this));
        if (after_ < before_ || after_ - before_ != amount) revert InvalidReceivedAmount();
        _fab.accrue(amount, totalSupply);
        cumulativeIncentiveFab += amount;
        emit IncentiveRecorded(msg.sender, amount, totalSupply, cumulativeIncentiveFab);
    }

    /// @notice FAB recorded while no LP existed; never redistributed to later LPs.
    function unallocatedFab() external view virtual returns (uint256) {
        return _fab.parked;
    }

    function claimable(address account) external view virtual returns (uint256, uint256) {
        return (
            _fab.claimable(account, balanceOf[account]), _okb.claimable(account, balanceOf[account])
        );
    }

    function rewardLiabilities() external view virtual returns (uint256, uint256) {
        return (_fab.reserved, _okb.reserved);
    }

    /// @notice Anyone may trigger payment, but funds can only go to their recorded owner.
    function claimFor(address account) external nonReentrant returns (uint256 fab, uint256 okb) {
        fab = _claimFab(account);
        okb = _claimOkb(account);
        emit RewardsClaimed(account, fab, okb);
    }

    /// @notice FAB can still be collected when the account rejects native OKB.
    function claimFabFor(address account) external nonReentrant returns (uint256 fab) {
        fab = _claimFab(account);
        emit RewardsClaimed(account, fab, 0);
    }

    /// @notice OKB can still be collected when the FAB token cannot be transferred.
    function claimOkbFor(address account) external nonReentrant returns (uint256 okb) {
        okb = _claimOkb(account);
        emit RewardsClaimed(account, 0, okb);
    }

    function _claimFab(address account) internal virtual returns (uint256 fab) {
        // Keep self-owned LP income reserved; a FAB self-transfer pays out nothing.
        if (account == address(this)) revert InvalidBinding();
        fab = _fab.take(account, balanceOf[account]);
        if (fab != 0) FAB.safeTransfer(account, fab);
    }

    function _claimOkb(address account) private returns (uint256 okb) {
        okb = _okb.take(account, balanceOf[account]);
        if (okb != 0) {
            (bool success,) = payable(account).call{ value: okb }("");
            if (!success) revert TransferFailed();
        }
    }
}

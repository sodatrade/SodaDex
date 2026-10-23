// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SodaPool } from "./SodaPool.sol";

/// @notice One independently timed LP lock per instance; no owner rescue or lock shortening.
contract SodaLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;
    SodaPool public immutable POOL;
    address public immutable FUNDER;
    /// @notice True for pools whose LP FAB is funded per epoch after confirmation (MirrorEpochPool,
    ///         MirrorFabsPool). Their FAB reaches this locker up to two epochs after it was earned,
    ///         and the locker pays whoever is beneficiary on arrival, so a handover would move income
    ///         earned before it to the new beneficiary. The beneficiary is therefore fixed for them.
    bool public immutable EPOCH_REWARDS;
    address public beneficiary;
    address public pendingBeneficiary;
    uint256 public unlockAt;
    uint256 public locked;
    mapping(address => uint256) public fabOwed;
    mapping(address => uint256) public okbOwed;
    error Unauthorized();
    error InvalidLock();
    error TransferFailed();
    error HandoverUnsupported();
    event Locked(address indexed beneficiary, uint256 amount, uint256 unlockAt);
    event BeneficiaryProposed(address indexed beneficiary);
    event BeneficiaryChanged(address indexed previous, address indexed next);

    constructor(SodaPool pool, address receiver) {
        if (address(pool).code.length == 0 || receiver == address(0) || receiver == address(this)) {
            revert InvalidLock();
        }
        POOL = pool;
        bytes32 version = pool.PRODUCT_VERSION();
        EPOCH_REWARDS = version == keccak256("SodaDEX.OKB.MirrorEpochPool.v1")
            || version == keccak256("SodaDEX.OKB.MirrorFabsPool.v1");
        beneficiary = receiver;
        FUNDER = msg.sender;
    }

    receive() external payable {
        if (msg.sender != address(POOL.REWARDS())) revert Unauthorized();
    }

    function lock(uint256 amount) external nonReentrant {
        if (msg.sender != FUNDER) revert Unauthorized();
        if (unlockAt != 0 || amount == 0) revert InvalidLock();
        IERC20(address(POOL)).safeTransferFrom(msg.sender, address(this), amount);
        locked = amount;
        unlockAt = block.timestamp + 60 days;
        emit Locked(beneficiary, amount, unlockAt);
    }

    function harvest() external nonReentrant {
        _checkpoint();
    }

    function proposeBeneficiary(address next) external {
        if (msg.sender != beneficiary) revert Unauthorized();
        if (EPOCH_REWARDS) revert HandoverUnsupported();
        if (next == address(0) || next == address(this)) revert InvalidLock();
        pendingBeneficiary = next;
        emit BeneficiaryProposed(next);
    }

    function acceptBeneficiary() external nonReentrant {
        if (msg.sender != pendingBeneficiary) revert Unauthorized();
        _checkpoint();
        address previous = beneficiary;
        beneficiary = msg.sender;
        pendingBeneficiary = address(0);
        emit BeneficiaryChanged(previous, msg.sender);
    }

    function withdraw() external nonReentrant {
        if (msg.sender != beneficiary) revert Unauthorized();
        if (unlockAt == 0 || block.timestamp < unlockAt || locked == 0) revert InvalidLock();
        _checkpoint();
        uint256 amount = locked;
        locked = 0;
        IERC20(address(POOL)).safeTransfer(beneficiary, amount);
    }

    /// @notice Old beneficiaries can still collect their cached income after an accepted handover.
    function claimFor(address account) external nonReentrant {
        uint256 f = fabOwed[account];
        uint256 n = okbOwed[account];
        fabOwed[account] = 0;
        okbOwed[account] = 0;
        fabReserved -= f;
        okbReserved -= n;
        if (f != 0) POOL.FAB().safeTransfer(account, f);
        if (n != 0) {
            (bool ok,) = payable(account).call{ value: n }("");
            if (!ok) revert TransferFailed();
        }
    }

    function _checkpoint() private {
        POOL.harvest();
        // claimFor can also be called externally: measure balances, not only this call's return.
        POOL.REWARDS().claimFor(address(this));
        uint256 f = POOL.FAB().balanceOf(address(this)) - fabReserved;
        uint256 n = address(this).balance - okbReserved;
        fabOwed[beneficiary] += f;
        okbOwed[beneficiary] += n;
        fabReserved += f;
        okbReserved += n;
    }
    uint256 private fabReserved;
    uint256 private okbReserved;
}

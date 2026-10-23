// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Receives only the special pool's platform OKB and LP-attributable FAB.
/// @dev IGNIX distributes FAB using historical LP ownership, not claim-time balances.
contract IgnixTreasuryIncome is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable POOL;
    IERC20 public immutable FAB;
    address public immutable RECIPIENT;
    uint256 public platformOkbOwed;
    uint256 public lpFabOwed;
    uint256 public cumulativePlatformOkb;
    uint256 public cumulativeLpFab;
    error Unauthorized();
    error InvalidRecipient();
    error TransferFailed();
    event PlatformOkbRecorded(uint256 amount, uint256 cumulativeAmount);
    /// @dev Emitted before the corresponding LP mint/burn/transfer; use log order.
    event LpFabRecorded(uint256 amount, uint256 lpSupply, uint256 cumulativeAmount);
    event IncomePaid(address indexed recipient, uint256 okb, uint256 fab);

    constructor(IERC20 fab, address recipient) {
        if (
            address(fab) == address(0) || recipient == address(0) || recipient == msg.sender
                || recipient == address(this)
        ) revert InvalidRecipient();
        POOL = msg.sender;
        FAB = fab;
        RECIPIENT = recipient;
    }

    modifier onlyPool() {
        if (msg.sender != POOL) revert Unauthorized();
        _;
    }

    function recordPlatformOkb() external payable onlyPool {
        platformOkbOwed += msg.value;
        cumulativePlatformOkb += msg.value;
        emit PlatformOkbRecorded(msg.value, cumulativePlatformOkb);
    }

    function recordLpFab(uint256 lpSupply) external onlyPool {
        uint256 amount = FAB.balanceOf(address(this)) - lpFabOwed;
        if (amount == 0) return;
        lpFabOwed += amount;
        cumulativeLpFab += amount;
        emit LpFabRecorded(amount, lpSupply, cumulativeLpFab);
    }

    /// @notice Anyone can pay gas to deliver funds, but cannot choose the recipient.
    /// @dev Separate claims keep a failed native transfer from blocking FAB delivery.
    function claimPlatformOkb() external nonReentrant returns (uint256 amount) {
        amount = platformOkbOwed;
        platformOkbOwed = 0;
        if (amount != 0) {
            (bool success,) = payable(RECIPIENT).call{ value: amount }("");
            if (!success) revert TransferFailed();
        }
        emit IncomePaid(RECIPIENT, amount, 0);
    }

    function claimLpFab() external nonReentrant returns (uint256 amount) {
        amount = lpFabOwed;
        lpFabOwed = 0;
        if (amount != 0) FAB.safeTransfer(RECIPIENT, amount);
        emit IncomePaid(RECIPIENT, 0, amount);
    }
}

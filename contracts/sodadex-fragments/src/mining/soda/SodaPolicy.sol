// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Immutable economics; two-step owner, individually paused operations, delayed treasury.
contract SodaPolicy is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant TREASURY_DELAY = 48 hours;
    uint256 public constant REDEMPTION_WEI_PER_WEIGHT = 1e12;
    IERC20 public immutable FAB;
    address private _treasury;
    address public pendingTreasury;
    uint256 public treasuryEffectiveAt;
    mapping(uint8 => bool) public paused;
    mapping(address => uint256) public fabOwed;
    mapping(address => uint256) public okbOwed;
    event TreasuryScheduled(address indexed treasury, uint256 effectiveAt);
    event OperationPaused(uint8 indexed operation, bool paused, string reason);
    event Income(address indexed beneficiary, uint256 serviceFab, uint256 sodaFab, uint256 okb);
    error InvalidConfiguration();
    error OperationUnavailable(uint8 operation);

    constructor(address admin, address treasury_, IERC20 fab) Ownable(admin) {
        if (treasury_ == address(0) || treasury_ == address(this) || address(fab).code.length == 0)
        {
            revert InvalidConfiguration();
        }
        _treasury = treasury_;
        FAB = fab;
    }

    function treasury() public view returns (address) {
        return treasuryEffectiveAt != 0 && block.timestamp >= treasuryEffectiveAt
            ? pendingTreasury
            : _treasury;
    }

    function scheduleTreasury(address next) external onlyOwner {
        if (next == address(0) || next == address(this)) revert InvalidConfiguration();
        _treasury = treasury();
        pendingTreasury = next;
        treasuryEffectiveAt = block.timestamp + TREASURY_DELAY;
        emit TreasuryScheduled(next, treasuryEffectiveAt);
    }

    /// @dev 0 swap, 1 deposit NFT, 2 add LP, 3 redeem NFT, 4 remove LP. Claims cannot be paused.
    function setPaused(uint8 op, bool value, string calldata reason) external onlyOwner {
        if (op > 4 || bytes(reason).length == 0) revert InvalidConfiguration();
        paused[op] = value;
        emit OperationPaused(op, value, reason);
    }

    function check(uint8 op) external view {
        if (paused[op]) revert OperationUnavailable(op);
    }

    function renounceOwnership() public override onlyOwner {
        for (uint8 i; i < 5; ++i) {
            if (paused[i]) revert InvalidConfiguration();
        }
        super.renounceOwnership();
    }

    function recordNative() external payable {
        address t = treasury();
        okbOwed[t] += msg.value;
        emit Income(t, 0, 0, msg.value);
    }

    function recordFab(uint256 service, uint256 soda) external nonReentrant {
        uint256 amount = service + soda;
        uint256 before_ = FAB.balanceOf(address(this));
        FAB.safeTransferFrom(msg.sender, address(this), amount);
        if (FAB.balanceOf(address(this)) - before_ != amount) revert InvalidConfiguration();
        address t = treasury();
        fabOwed[t] += amount;
        emit Income(t, service, soda, 0);
    }

    function claimFor(address account) external nonReentrant {
        uint256 f = fabOwed[account];
        uint256 n = okbOwed[account];
        fabOwed[account] = 0;
        okbOwed[account] = 0;
        if (f != 0) FAB.safeTransfer(account, f);
        if (n != 0) {
            (bool ok,) = payable(account).call{ value: n }("");
            if (!ok) revert InvalidConfiguration();
        }
    }
}

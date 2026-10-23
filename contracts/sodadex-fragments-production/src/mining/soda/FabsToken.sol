// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IFabsVault } from "./interfaces/IFabsVault.sol";

/// @notice Zero-premine shares. Only the permanently bound vault can mint or burn.
/// @dev Miner backing is enforced by the bound vault, not independently verified by this token.
contract FabsToken is ERC20, ReentrancyGuard {
    bytes32 public constant HOOK_VERSION = keccak256("SodaDEX.FABS.VaultHook.v1");
    address public immutable owner;
    address public vault;

    error Unauthorized();
    error InvalidOwner();
    error InvalidVault();
    error AlreadyBound();
    error VaultNotBound();
    error InvalidHookResponse();
    event VaultBound(address indexed vault);

    constructor(address initialOwner) ERC20("FAB Miner Shares", "FABS") {
        if (initialOwner == address(0) || initialOwner == address(this)) revert InvalidOwner();
        owner = initialOwner;
    }

    /// @notice One-time owner action. No replacement, recovery or owner mint role exists.
    function bindVault(address candidate) external nonReentrant {
        if (msg.sender != owner) revert Unauthorized();
        if (vault != address(0)) revert AlreadyBound();
        if (candidate == address(this) || candidate.code.length == 0) revert InvalidVault();
        IFabsVault target = IFabsVault(candidate);
        if (target.FABS() != address(this) || target.FABS_HOOK_VERSION() != HOOK_VERSION) {
            revert InvalidVault();
        }
        vault = candidate;
        emit VaultBound(candidate);
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert Unauthorized();
        _;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    /// @dev The vault must validate the user's redemption request before burning; no ERC20
    /// allowance is used here, matching the vault's previous internal _burn semantics.
    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 amount) internal override nonReentrant {
        address source = vault;
        if (source == address(0)) revert VaultNotBound();
        if (
            IFabsVault(source).beforeFabsTransfer(from, to, amount)
                != IFabsVault.beforeFabsTransfer.selector
        ) {
            revert InvalidHookResponse();
        }
        super._update(from, to, amount);
    }
}

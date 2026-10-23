// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RewardLedger } from "./RewardLedger.sol";

abstract contract SodaRewards is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using RewardLedger for RewardLedger.Book;
    IERC20 public immutable FAB;
    RewardLedger.Book internal _fab;
    RewardLedger.Book internal _okb;
    error InvalidBinding();
    error NativeTransferFailed();
    event RewardsClaimed(address indexed account, uint256 fab, uint256 okb);

    constructor(IERC20 fab, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        if (address(fab).code.length == 0) revert InvalidBinding();
        FAB = fab;
    }

    function claimable(address account) public view returns (uint256 fab, uint256 okb) {
        return (
            _fab.claimable(account, balanceOf(account)), _okb.claimable(account, balanceOf(account))
        );
    }

    function rewardLiabilities() external view returns (uint256, uint256) {
        return (_fab.reserved, _okb.reserved);
    }

    /// @notice Pays cached income to its owner. No dependency on live mining or owner pause flags.
    function claimFor(address account) public nonReentrant returns (uint256 fab, uint256 okb) {
        fab = _fab.take(account, balanceOf(account));
        okb = _okb.take(account, balanceOf(account));
        if (fab != 0) FAB.safeTransfer(account, fab);
        if (okb != 0) _sendNative(account, okb);
        emit RewardsClaimed(account, fab, okb);
    }

    function transfer(address to, uint256 value) public override nonReentrant returns (bool) {
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        nonReentrant
        returns (bool)
    {
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 amount) internal override {
        _checkpoint();
        _fab.move(from, to, amount);
        _okb.move(from, to, amount);
        super._update(from, to, amount);
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{ value: amount }("");
        if (!ok) revert NativeTransferFailed();
    }
    function _checkpoint() internal virtual;
}

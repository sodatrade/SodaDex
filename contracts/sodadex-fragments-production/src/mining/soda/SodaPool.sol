// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IgnixLpRewards } from "./IgnixLpRewards.sol";
import { SodaVault } from "./SodaVault.sol";
import { SodaPolicy } from "./SodaPolicy.sol";

/// @notice Single native OKB/share AMM. Fees never compound into withdrawable LP principal.
contract SodaPool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IgnixLpRewards public immutable REWARDS;
    IERC20 public immutable FAB;

    function PRODUCT_VERSION() public pure virtual returns (bytes32) {
        return keccak256("SodaDEX.OKB.Fragments.v3");
    }
    SodaVault public immutable VAULT;
    SodaPolicy public immutable POLICY;
    uint256 public reserveShares;
    uint256 public reserveOkb;
    error Expired();
    error Slippage();
    error EmptyAmount();
    error InvalidTransfer();
    event Swapped(
        address indexed account,
        bool shareIn,
        uint256 input,
        uint256 output,
        uint256 platformFee,
        uint256 lpFee
    );
    event LiquidityAdded(address indexed account, uint256 shares, uint256 okb, uint256 liquidity);
    event LiquidityRemoved(address indexed account, uint256 shares, uint256 okb, uint256 liquidity);

    constructor(SodaVault vault) ERC20("SodaDEX OKB Miner LP", "sLP") {
        VAULT = vault;
        POLICY = vault.POLICY();
        FAB = vault.FAB();
        REWARDS = new IgnixLpRewards(FAB, address(vault));
    }

    function fees(uint256 grossOkb) public pure returns (uint256 platform, uint256 lp) {
        uint256 total = Math.mulDiv(grossOkb, 50, 10000);
        platform = Math.mulDiv(total, 30, 100);
        lp = total - platform;
    }

    function quote(bool shareIn, uint256 input)
        public
        view
        returns (uint256 output, uint256 platform, uint256 lp)
    {
        if (input == 0 || reserveShares == 0 || reserveOkb == 0) return (0, 0, 0);
        if (shareIn) {
            uint256 gross = Math.mulDiv(reserveOkb, input, reserveShares + input);
            (platform, lp) = fees(gross);
            output = gross - platform - lp;
        } else {
            (platform, lp) = fees(input);
            uint256 net = input - platform - lp;
            output = Math.mulDiv(reserveShares, net, reserveOkb + net);
        }
    }

    function addLiquidity(
        uint256 desiredShares,
        uint256 minimumShares,
        uint256 minimumOkb,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 liquidity) {
        _deadline(deadline);
        POLICY.check(2);
        _checkpoint();
        if (VAULT.totalEligibleWeight() == 0) revert EmptyAmount();
        uint256 shares = desiredShares;
        uint256 okb = msg.value;
        uint256 supply = totalSupply();
        if (supply != 0) {
            uint256 required = Math.mulDiv(shares, reserveOkb, reserveShares);
            if (required <= okb) okb = required;
            else shares = Math.mulDiv(okb, reserveShares, reserveOkb);
        }
        if (shares == 0 || okb == 0) revert EmptyAmount();
        liquidity = supply == 0
            ? Math.sqrt(shares * okb)
            : Math.min(
                Math.mulDiv(shares, supply, reserveShares), Math.mulDiv(okb, supply, reserveOkb)
            );
        if (liquidity == 0) revert EmptyAmount();
        if (supply != 0) {
            // Charge only the backing of LP actually minted. Full desired inputs
            // can otherwise donate large amounts to old LPs when supply is tiny.
            shares = Math.mulDiv(liquidity, reserveShares, supply, Math.Rounding.Ceil);
            okb = Math.mulDiv(liquidity, reserveOkb, supply, Math.Rounding.Ceil);
        }
        if (shares < minimumShares || okb < minimumOkb) revert Slippage();
        _pull(shares);
        reserveShares += shares;
        reserveOkb += okb;
        _mint(msg.sender, liquidity);
        if (msg.value > okb) _sendNative(msg.sender, msg.value - okb);
        emit LiquidityAdded(msg.sender, shares, okb, liquidity);
    }

    function removeLiquidity(
        uint256 liquidity,
        uint256 minimumShares,
        uint256 minimumOkb,
        uint256 deadline
    ) external nonReentrant returns (uint256 shares, uint256 okb) {
        _deadline(deadline);
        POLICY.check(4);
        _checkpoint();
        uint256 supply = totalSupply();
        if (liquidity == 0 || supply == 0) revert EmptyAmount();
        shares = Math.mulDiv(reserveShares, liquidity, supply);
        okb = Math.mulDiv(reserveOkb, liquidity, supply);
        if (shares < minimumShares || okb < minimumOkb) revert Slippage();
        _burn(msg.sender, liquidity);
        reserveShares -= shares;
        reserveOkb -= okb;
        IERC20(address(VAULT)).safeTransfer(msg.sender, shares);
        _sendNative(msg.sender, okb);
        emit LiquidityRemoved(msg.sender, shares, okb, liquidity);
    }

    function swap(bool shareIn, uint256 input, uint256 minimumOutput, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 output)
    {
        _deadline(deadline);
        POLICY.check(0);
        _checkpoint();
        if (VAULT.totalEligibleWeight() == 0) revert EmptyAmount();
        if (shareIn ? msg.value != 0 : msg.value != input) revert InvalidTransfer();
        uint256 platform;
        uint256 lp;
        (output, platform, lp) = quote(shareIn, input);
        if (output == 0) revert EmptyAmount();
        if (output < minimumOutput) revert Slippage();
        if (shareIn) {
            _pull(input);
            reserveShares += input;
            reserveOkb -= output + platform + lp;
        } else {
            reserveOkb += input - platform - lp;
            reserveShares -= output;
        }
        if (lp != 0) REWARDS.recordOkb{ value: lp }();
        if (platform != 0) _recordPlatform(platform);
        if (shareIn) _sendNative(msg.sender, output);
        else IERC20(address(VAULT)).safeTransfer(msg.sender, output);
        emit Swapped(msg.sender, shareIn, input, output, platform, lp);
    }

    function harvest() external nonReentrant {
        _checkpoint();
    }

    function _checkpoint() internal {
        VAULT.harvest();
        VAULT.claimFor(address(this));
        // Includes payouts triggered by third parties; rewards never enter principal.
        _recordFab();
    }

    function _recordPlatform(uint256 amount) internal virtual {
        POLICY.recordNative{ value: amount }();
    }

    function _recordFab() internal virtual {
        uint256 amount = FAB.balanceOf(address(this));
        if (amount != 0) FAB.safeTransfer(address(REWARDS), amount);
        REWARDS.recordFab();
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
        REWARDS.move(from, to, amount);
        super._update(from, to, amount);
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{ value: amount }("");
        if (!ok) revert InvalidTransfer();
    }

    function _pull(uint256 amount) private {
        uint256 before_ = VAULT.balanceOf(address(this));
        IERC20(address(VAULT)).safeTransferFrom(msg.sender, address(this), amount);
        if (VAULT.balanceOf(address(this)) - before_ != amount) revert InvalidTransfer();
    }

    function _deadline(uint256 deadline) private view {
        if (block.timestamp > deadline) revert Expired();
    }
}

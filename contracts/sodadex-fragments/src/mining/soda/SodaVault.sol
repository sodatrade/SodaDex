// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IFabxMining } from "../interfaces/IFabxMining.sol";
import { FabxMinerCustody } from "../FabxMinerCustody.sol";
import { SodaRewards } from "./SodaRewards.sol";
import { SodaPolicy } from "./SodaPolicy.sol";
import { RewardLedger } from "./RewardLedger.sol";

contract SodaVault is FabxMinerCustody, SodaRewards {
    using SafeERC20 for IERC20;
    using RewardLedger for RewardLedger.Book;
    uint256 public constant INITIAL_SHARES_PER_WEIGHT = 1000 ether;
    bytes32 public constant PRODUCT_VERSION = keccak256("SodaDEX.OKB.Fragments.v1");
    SodaPolicy public immutable POLICY;
    error Slippage();
    error InvalidAmount();
    event Deposited(address indexed account, uint256 indexed id, uint256 weight, uint256 shares);
    event Redeemed(address indexed account, uint256 indexed id, uint256 shares, uint256 fee);

    constructor(
        IERC20 fab,
        IFabxMining mining,
        IERC721 nft,
        address factory,
        uint16 capacity,
        SodaPolicy policy
    )
        FabxMinerCustody(fab, mining, nft, factory, capacity)
        SodaRewards(fab, "SodaDEX Miner Shares", "sFAB")
    {
        if (address(policy).code.length == 0 || address(policy.FAB()) != address(fab)) {
            revert InvalidBinding();
        }
        POLICY = policy;
    }

    function previewDeposit(uint256 id) public view returns (uint256 shares) {
        if (containsMiner(id) || !admissibleMiner(id)) revert IneligibleMiner();
        uint256 w = eligibleWeight(id);
        uint256 supply = totalSupply();
        uint256 total = totalEligibleWeight();
        if (minerCount() != 0 && total == 0) revert IneligibleMiner();
        shares = supply == 0 ? w * INITIAL_SHARES_PER_WEIGHT : Math.mulDiv(w, supply, total);
    }

    function previewRedeem(uint256 id) public view returns (uint256 shares, uint256 fee) {
        uint256 w = eligibleWeight(id);
        if (!containsMiner(id) || w == 0) revert IneligibleMiner();
        shares = Math.mulDiv(w, totalSupply(), totalEligibleWeight(), Math.Rounding.Ceil);
        fee = w * POLICY.REDEMPTION_WEI_PER_WEIGHT();
    }

    function deposit(uint256 id, uint256 minimumShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        POLICY.check(1);
        _checkpoint();
        shares = previewDeposit(id);
        if (shares == 0) revert InvalidAmount();
        if (shares < minimumShares) revert Slippage();
        uint256 weight = _depositMiner(msg.sender, id);
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, id, weight, shares);
    }

    function redeem(uint256 id, uint256 maximumShares)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        POLICY.check(3);
        _checkpoint();
        uint256 fee;
        (shares, fee) = previewRedeem(id);
        if (shares == 0 || msg.value != fee) revert InvalidAmount();
        if (shares > maximumShares) revert Slippage();
        _burn(msg.sender, shares);
        _releaseMiner(id, msg.sender);
        POLICY.recordNative{ value: fee }();
        emit Redeemed(msg.sender, id, shares, fee);
    }

    function harvest() external nonReentrant {
        _checkpoint();
    }

    function _checkpoint() internal virtual override {
        (uint256 received,) = _collectMining();
        if (received == 0) return;
        uint256 service = Math.mulDiv(received, 1000, 10000);
        uint256 soda = Math.mulDiv(received, 500, 10000);
        uint256 fee = service + soda;
        if (fee != 0) {
            FAB.forceApprove(address(POLICY), fee);
            POLICY.recordFab(service, soda);
        }
        _fab.accrue(received - fee, totalSupply());
    }
}

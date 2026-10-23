// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IFabxMining } from "../interfaces/IFabxMining.sol";
import { RewardLedger } from "./RewardLedger.sol";
import { SodaVault } from "./SodaVault.sol";
import { SodaPolicy } from "./SodaPolicy.sol";
import { SodaPool } from "./SodaPool.sol";
import { IgnixLpRewards } from "./IgnixLpRewards.sol";

/// @notice Miner-backed shares: 85% to shares, 10% to treasury, 5% to historical LPs.
/// @dev The pool address is fixed before deployment; neither owner nor deployer can replace it.
contract SodaIncentiveVault is SodaVault {
    using SafeERC20 for IERC20;
    using RewardLedger for RewardLedger.Book;

    address public immutable LP_POOL;
    uint256 public cumulativeMiningFab;
    uint256 public cumulativeIncentiveFab;

    event MiningIncomeSplit(uint256 received, uint256 holders, uint256 treasury, uint256 incentive);

    constructor(
        IERC20 fab,
        IFabxMining mining,
        IERC721 nft,
        address factory,
        uint16 capacity,
        SodaPolicy policy,
        address lpPool
    ) SodaVault(fab, mining, nft, factory, capacity, policy) {
        // The pool is deployed next and its constructor reads this vault's FAB and POLICY.
        if (lpPool == address(0) || lpPool == address(this) || lpPool == address(fab)) {
            revert InvalidBinding();
        }
        LP_POOL = lpPool;
    }

    function lpRewards() public view returns (IgnixLpRewards rewards) {
        rewards = SodaPool(LP_POOL).REWARDS();
        if (
            rewards.POOL() != LP_POOL || rewards.INCENTIVE_SOURCE() != address(this)
                || address(rewards.FAB()) != address(FAB)
        ) revert InvalidBinding();
    }

    function _checkpoint() internal override {
        (uint256 received,) = _collectMining();
        if (received == 0) return;
        uint256 service = Math.mulDiv(received, 1000, 10000);
        uint256 incentive = Math.mulDiv(received, 500, 10000);
        uint256 holders = received - service - incentive;
        cumulativeMiningFab += received;
        cumulativeIncentiveFab += incentive;
        if (service != 0) {
            FAB.forceApprove(address(POLICY), service);
            POLICY.recordFab(service, 0);
            FAB.forceApprove(address(POLICY), 0);
        }
        if (incentive != 0) {
            IgnixLpRewards rewards = lpRewards();
            FAB.forceApprove(address(rewards), incentive);
            rewards.notifyIncentive(incentive);
            FAB.forceApprove(address(rewards), 0);
        }
        _fab.accrue(holders, totalSupply());
        emit MiningIncomeSplit(received, holders, service, incentive);
    }
}

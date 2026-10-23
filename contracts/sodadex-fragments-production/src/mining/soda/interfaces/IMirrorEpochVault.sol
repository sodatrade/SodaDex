// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IMirrorEpochVault {
    /// @dev Must equal keccak256("SodaDEX.MirrorEpochRewards.v1"). Explicit opt-in, not ABI guessing.
    function LP_REWARDS_VERSION() external view returns (bytes32);
    function openEpoch() external view returns (uint64);
}

/// @dev Vault-only hooks. See the integration document for the mandatory ordering and weight units.
interface IMirrorEpochRewards {
    function checkpoint(uint64 epoch, uint256 cumulativePoolWeight) external;
    function closeEpoch(uint64 epoch, uint256 cumulativePoolWeight) external;
    function notifyEpochRewards(uint64 epoch, uint256 poolFab, uint256 incentiveFab) external;
    function activeSeconds(uint64 epoch) external view returns (uint256);
}

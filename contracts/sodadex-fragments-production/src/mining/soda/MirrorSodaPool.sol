// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SodaIgnixPool} from "./SodaIgnixPool.sol";
import {SodaVault} from "./SodaVault.sol";
import {IgnixLpRewards} from "./IgnixLpRewards.sol";
import {MirrorLpRewards} from "./MirrorLpRewards.sol";
import {IMirrorEpochVault} from "./interfaces/IMirrorEpochVault.sol";

/// @notice The same AMM and OKB fees, with historical FAB funding from a compatible new vault.
contract MirrorSodaPool is SodaIgnixPool {
    error IncompatibleVault();
    constructor(SodaVault vault, address treasury) SodaIgnixPool(vault, treasury) {}

    function _newRewards(SodaVault vault) internal override returns (IgnixLpRewards) {
        IMirrorEpochVault source = IMirrorEpochVault(address(vault));
        if (source.LP_REWARDS_VERSION() != keccak256("SodaDEX.MirrorEpochRewards.v1") || source.openEpoch() != 1) {
            revert IncompatibleVault();
        }
        return new MirrorLpRewards(vault.FAB(), address(vault));
    }

    function _checkpoint() internal override {
        // The vault must sync REWARDS even when no epoch closes. It pushes epoch FAB directly;
        // claiming to this pool here would lose provenance and duplicate the historical payment.
        VAULT.harvest();
    }

    function PRODUCT_VERSION() public pure virtual override returns (bytes32) {
        return keccak256("SodaDEX.OKB.MirrorEpochPool.v1");
    }
}

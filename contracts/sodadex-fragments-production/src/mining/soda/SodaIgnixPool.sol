// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { SodaPool } from "./SodaPool.sol";
import { SodaVault } from "./SodaVault.sol";
import { IgnixTreasuryIncome } from "./IgnixTreasuryIncome.sol";

/// @notice New independent special pool; does not migrate old pools or their reward debt.
contract SodaIgnixPool is SodaPool {
    IgnixTreasuryIncome public immutable INCOME;

    constructor(SodaVault vault, address ignixTreasury) SodaPool(vault) {
        INCOME = new IgnixTreasuryIncome(FAB, ignixTreasury);
    }

    function PRODUCT_VERSION() public pure override returns (bytes32) {
        return keccak256("SodaDEX.OKB.Fragments.Formal.v1");
    }

    function _recordPlatform(uint256 amount) internal override {
        INCOME.recordPlatformOkb{ value: amount }();
    }
}

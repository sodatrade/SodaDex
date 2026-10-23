// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SodaVault } from "./SodaVault.sol";
import { MirrorSodaPool } from "./MirrorSodaPool.sol";
import { FabsToken } from "./FabsToken.sol";
import { IFabsVault } from "./interfaces/IFabsVault.sol";

/// @notice Epoch-aware AMM using a separate FABS token and a non-ERC20 business vault.
contract MirrorFabsPool is MirrorSodaPool {
    constructor(SodaVault source, address treasury) MirrorSodaPool(source, treasury) { }

    function _shareToken(SodaVault source) internal view override returns (IERC20) {
        address token = IFabsVault(address(source)).FABS();
        if (token == address(source) || token.code.length == 0) revert IncompatibleVault();
        if (FabsToken(token).vault() != address(source)) revert IncompatibleVault();
        return IERC20(token);
    }

    function PRODUCT_VERSION() public pure override returns (bytes32) {
        return keccak256("SodaDEX.OKB.MirrorFabsPool.v1");
    }
}

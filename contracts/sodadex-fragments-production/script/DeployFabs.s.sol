// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Vm } from "forge-std/Vm.sol";
import { FabsToken } from "../src/mining/soda/FabsToken.sol";

/// @notice Deploys only the empty token. No binding, minting, LP or treasury transactions.
contract DeployFabs {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (FabsToken token) {
        require(block.chainid == 196, "Expected X Layer 196");
        address initialOwner = vm.envAddress("FABS_OWNER");
        require(initialOwner != address(0), "FABS_OWNER required");
        vm.startBroadcast();
        token = new FabsToken(initialOwner);
        vm.stopBroadcast();
    }
}

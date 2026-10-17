// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PrepareFabx1952} from "../script/PrepareFabx1952.s.sol";

contract PrepareFabx1952GuardTest is Test {
    address private constant OWNER = 0x6ecf746b078d46391f8C425B150153212F7C0545;

    function test_rejects196BeforeAnyDeploymentOrNonceUse() public {
        PrepareFabx1952 script = new PrepareFabx1952();
        vm.chainId(196);
        uint256 nonce = vm.getNonce(OWNER);
        vm.expectRevert(PrepareFabx1952.WrongTestChain.selector);
        script.run();
        assertEq(vm.getNonce(OWNER), nonce);
    }

    function test_rejectsUnexpectedOwnerBeforeAnyDeploymentOrNonceUse() public {
        PrepareFabx1952 script = new PrepareFabx1952();
        vm.chainId(1952);
        uint256 nonce = vm.getNonce(OWNER);
        vm.expectRevert(PrepareFabx1952.WrongTestOwner.selector);
        script.run();
        assertEq(vm.getNonce(OWNER), nonce);
    }
}

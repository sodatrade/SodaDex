// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { FabsToken } from "../../../src/mining/soda/FabsToken.sol";
import { IFabsVault } from "../../../src/mining/soda/interfaces/IFabsVault.sol";

/// @dev Hook fixture only: does not represent real miner custody or a production vault.
contract FabsHookFixture {
    FabsToken public immutable FABS;
    bytes32 public FABS_HOOK_VERSION = keccak256("SodaDEX.FABS.VaultHook.v1");
    mapping(address => uint256) public locked;
    uint256 public fromBefore;
    uint256 public toBefore;
    uint256 public supplyBefore;
    uint256 public calls;
    uint8 public mode;
    error Locked();
    error HookFailure();

    constructor(FabsToken token) {
        FABS = token;
    }

    function setMode(uint8 value) external {
        mode = value;
    }

    function setVersion(bytes32 value) external {
        FABS_HOOK_VERSION = value;
    }

    function setLocked(address account, uint256 amount) external {
        locked[account] = amount;
    }

    function mint(address account, uint256 amount) external {
        FABS.mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        FABS.burn(account, amount);
    }

    function beforeFabsTransfer(address from, address to, uint256 amount)
        external
        returns (bytes4)
    {
        require(msg.sender == address(FABS));
        if (mode == 1) revert HookFailure();
        if (mode == 2) return bytes4(0);
        if (mode == 3) FABS.mint(address(this), 1);
        if (from != address(0) && FABS.balanceOf(from) < locked[from] + amount) revert Locked();
        fromBefore = FABS.balanceOf(from);
        toBefore = FABS.balanceOf(to);
        supplyBefore = FABS.totalSupply();
        calls++;
        return IFabsVault.beforeFabsTransfer.selector;
    }
}

contract FabsTokenTest is Test {
    FabsToken token;
    FabsHookFixture vault;
    address owner = address(0xCAFE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address spender = address(0xBAD);

    function setUp() public {
        token = new FabsToken(owner);
        vault = new FabsHookFixture(token);
    }

    function bind() internal {
        vm.prank(owner);
        token.bindVault(address(vault));
    }

    function test_zeroPremineAndMetadata() public view {
        assertEq(token.name(), "FAB Miner Shares");
        assertEq(token.symbol(), "FABS");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
        assertEq(token.owner(), owner);
        assertEq(token.vault(), address(0));
    }

    function test_invalidOwnerRejected() public {
        vm.expectRevert(FabsToken.InvalidOwner.selector);
        new FabsToken(address(0));
    }

    function test_ownerCannotMintOrBurnBeforeOrAfterBinding() public {
        vm.startPrank(owner);
        vm.expectRevert(FabsToken.Unauthorized.selector);
        token.mint(owner, 1);
        token.bindVault(address(vault));
        vm.expectRevert(FabsToken.Unauthorized.selector);
        token.mint(owner, 1);
        vm.expectRevert(FabsToken.Unauthorized.selector);
        token.burn(alice, 1);
        vm.stopPrank();
    }

    function test_bindingOnlyOwnerAndOnce() public {
        vm.expectRevert(FabsToken.Unauthorized.selector);
        token.bindVault(address(vault));
        bind();
        vm.prank(owner);
        vm.expectRevert(FabsToken.AlreadyBound.selector);
        token.bindVault(address(vault));
        assertEq(token.vault(), address(vault));
    }

    function test_wrongTokenOrVersionRejected() public {
        FabsToken other = new FabsToken(owner);
        FabsHookFixture wrong = new FabsHookFixture(other);
        vm.prank(owner);
        vm.expectRevert(FabsToken.InvalidVault.selector);
        token.bindVault(address(wrong));
        vault.setVersion(bytes32(0));
        vm.prank(owner);
        vm.expectRevert(FabsToken.InvalidVault.selector);
        token.bindVault(address(vault));
        assertEq(token.vault(), address(0));
    }

    function test_eoaAndSelfBindingRejected() public {
        vm.startPrank(owner);
        vm.expectRevert(FabsToken.InvalidVault.selector);
        token.bindVault(alice);
        vm.expectRevert(FabsToken.InvalidVault.selector);
        token.bindVault(address(0));
        vm.expectRevert(FabsToken.InvalidVault.selector);
        token.bindVault(address(token));
        vm.stopPrank();
    }

    function test_unboundTransfersFail() public {
        vm.expectRevert(FabsToken.VaultNotBound.selector);
        token.transfer(bob, 0);
    }

    function test_hooksSeeOldBalancesForMintTransferAndBurn() public {
        bind();
        vault.mint(alice, 100);
        assertEq(vault.toBefore(), 0);
        assertEq(vault.supplyBefore(), 0);
        vm.prank(alice);
        token.transfer(bob, 30);
        assertEq(vault.fromBefore(), 100);
        assertEq(vault.toBefore(), 0);
        assertEq(vault.supplyBefore(), 100);
        vault.burn(bob, 10);
        assertEq(vault.fromBefore(), 30);
        assertEq(vault.supplyBefore(), 100);
        assertEq(token.totalSupply(), 90);
        assertEq(token.balanceOf(alice), 70);
        assertEq(token.balanceOf(bob), 20);
    }

    function test_lockedSharesCannotLeaveThroughAllowance() public {
        bind();
        vault.mint(alice, 100);
        vault.setLocked(alice, 80);
        vm.prank(alice);
        token.approve(spender, 100);
        vm.prank(spender);
        vm.expectRevert(FabsHookFixture.Locked.selector);
        token.transferFrom(alice, bob, 21);
        assertEq(token.allowance(alice, spender), 100);
        vm.prank(spender);
        token.transferFrom(alice, bob, 20);
        assertEq(token.balanceOf(alice), 80);
        assertEq(token.balanceOf(bob), 20);
        vault.setLocked(alice, 0);
        vault.burn(alice, 80);
        assertEq(token.totalSupply(), 20);
    }

    function test_hookFailureRollsBackBalancesAllowanceAndBookkeeping() public {
        bind();
        vault.mint(alice, 100);
        vm.prank(alice);
        token.approve(spender, 80);
        for (uint8 mode = 1; mode <= 3; mode++) {
            vault.setMode(mode);
            vm.prank(spender);
            vm.expectRevert();
            token.transferFrom(alice, bob, 50);
            assertEq(token.balanceOf(alice), 100);
            assertEq(token.balanceOf(bob), 0);
            assertEq(token.totalSupply(), 100);
            assertEq(token.allowance(alice, spender), 80);
            assertEq(vault.calls(), 1);
        }
        vault.setMode(0);
        vm.prank(spender);
        token.transferFrom(alice, bob, 50);
        assertEq(token.allowance(alice, spender), 30);
    }

    function test_selfAndZeroTransfersStillSettle() public {
        bind();
        vault.mint(alice, 100);
        vm.startPrank(alice);
        token.transfer(alice, 20);
        token.transfer(bob, 0);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.totalSupply(), 100);
        assertEq(vault.calls(), 3);
    }

    function testFuzz_supplyMatchesAuthorizedMintBurn(uint128 minted, uint128 burned) public {
        bind();
        uint256 burnAmount = bound(uint256(burned), 0, uint256(minted));
        vault.mint(alice, minted);
        vault.burn(alice, burnAmount);
        assertEq(token.totalSupply(), uint256(minted) - burnAmount);
        assertEq(token.balanceOf(alice), token.totalSupply());
    }

    function testFuzz_randomTransfersAndBurnsConserveSupply(uint256 seed) public {
        bind();
        uint256 backing;
        for (uint256 i; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address from = seed % 2 == 0 ? alice : bob;
            address to = from == alice ? bob : alice;
            uint256 amount = seed % 10000;
            if (seed % 3 == 0) {
                vault.mint(from, amount);
                backing += amount;
            } else {
                amount = bound(amount, 0, token.balanceOf(from));
                if (seed % 3 == 1) {
                    vm.prank(from);
                    token.transfer(to, amount);
                } else {
                    vault.burn(from, amount);
                    backing -= amount;
                }
            }
            assertEq(token.totalSupply(), backing);
            assertEq(token.balanceOf(alice) + token.balanceOf(bob), backing);
            vm.prank(spender);
            vm.expectRevert(FabsToken.Unauthorized.selector);
            token.mint(spender, amount);
        }
    }
}

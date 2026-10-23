// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { SodaPolicy } from "../../../src/mining/soda/SodaPolicy.sol";
import { SodaPool } from "../../../src/mining/soda/SodaPool.sol";
import { SodaVault } from "../../../src/mining/soda/SodaVault.sol";
import {
    MockFabxMining,
    MockMiningFab,
    MockMiningNft,
    MockMiningFactory
} from "../MiningProductMocks.sol";

contract SodaActor is Test {
    SodaPool pool;
    SodaVault vault;
    MockFabxMining mining;
    address a;
    address b;

    constructor(SodaPool p, SodaVault v, MockFabxMining m, address first, address second) {
        pool = p;
        vault = v;
        mining = m;
        a = first;
        b = second;
    }

    function trade(uint96 value, bool sell, bool second) external {
        address user = second ? b : a;
        uint256 amount = sell ? vault.balanceOf(user) : 1e15;
        if (amount == 0) return;
        amount = bound(value, 1, amount);
        (uint256 out,,) = pool.quote(sell, amount);
        if (out == 0) return;
        vm.startPrank(user);
        vault.approve(address(pool), amount);
        pool.swap{ value: sell ? 0 : amount }(sell, amount, out, block.timestamp);
        vm.stopPrank();
    }

    function transferLp(uint96 value, bool second) external {
        address from = second ? b : a;
        uint256 bal = pool.balanceOf(from);
        if (bal == 0) return;
        vm.prank(from);
        pool.transfer(second ? a : b, bound(value, 0, bal));
    }

    function add(uint96 value, bool second) external {
        address user = second ? b : a;
        uint256 bal = vault.balanceOf(user);
        if (bal == 0 || pool.totalSupply() == 0) return;
        uint256 shares = bound(value, 1, bal);
        uint256 okb = shares * pool.reserveOkb() / pool.reserveShares();
        if (okb == 0 || okb > user.balance) return;
        vm.startPrank(user);
        vault.approve(address(pool), shares);
        pool.addLiquidity{ value: okb }(shares, 0, 0, block.timestamp);
        vm.stopPrank();
    }

    function remove(uint96 value, bool second) external {
        address user = second ? b : a;
        uint256 bal = pool.balanceOf(user);
        if (bal == 0) return;
        vm.prank(user);
        pool.removeLiquidity(bound(value, 1, bal), 0, 0, block.timestamp);
    }

    function income(uint96 value, bool second) external {
        mining.setPending(1, bound(value, 0, 100e8));
        pool.harvest();
        pool.REWARDS().claimFor(second ? b : a);
    }
}

contract SodaSplitInvariantTest is Test {
    SodaPool pool;
    SodaVault vault;
    MockFabxMining mining;
    MockMiningFab fab;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        fab = new MockMiningFab();
        MockMiningFactory factory = new MockMiningFactory();
        MockMiningNft nft = new MockMiningNft(address(factory));
        factory.register(address(nft));
        mining = new MockFabxMining(fab, nft);
        SodaPolicy policy = new SodaPolicy(address(this), makeAddr("treasury"), fab);
        vault = new SodaVault(fab, mining, nft, address(factory), 8, policy);
        pool = new SodaPool(vault);
        nft.mint(alice, 1);
        mining.admit(1, 18);
        nft.mint(bob, 2);
        mining.admit(2, 432);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
        vm.startPrank(alice);
        nft.approve(address(vault), 1);
        vault.deposit(1, 1);
        vault.approve(address(pool), 9000 ether);
        pool.addLiquidity{ value: 1 ether }(9000 ether, 1, 1, block.timestamp);
        vm.stopPrank();
        vm.startPrank(bob);
        nft.approve(address(vault), 2);
        vault.deposit(2, 1);
        vm.stopPrank();
        SodaActor actor = new SodaActor(pool, vault, mining, alice, bob);
        targetContract(address(actor));
    }

    function invariant_principalAndIncomeHaveSeparateBacking() public view {
        assertEq(address(pool).balance, pool.reserveOkb());
        assertEq(vault.balanceOf(address(pool)), pool.reserveShares());
        (uint256 f, uint256 n) = pool.REWARDS().rewardLiabilities();
        assertGe(fab.balanceOf(address(pool.REWARDS())), f);
        assertGe(address(pool.REWARDS()).balance, n);
    }

    function invariant_ignixTracksEveryLpOwner() public view {
        assertEq(pool.REWARDS().totalSupply(), pool.totalSupply());
        assertEq(pool.REWARDS().balanceOf(alice), pool.balanceOf(alice));
        assertEq(pool.REWARDS().balanceOf(bob), pool.balanceOf(bob));
    }
}

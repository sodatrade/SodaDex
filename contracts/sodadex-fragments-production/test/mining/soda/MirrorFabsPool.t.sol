// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { MockMiningFab } from "../MiningProductMocks.sol";
import { FabsToken } from "../../../src/mining/soda/FabsToken.sol";
import { IFabsVault } from "../../../src/mining/soda/interfaces/IFabsVault.sol";
import { SodaPolicy } from "../../../src/mining/soda/SodaPolicy.sol";
import { SodaVault } from "../../../src/mining/soda/SodaVault.sol";
import { MirrorFabsPool } from "../../../src/mining/soda/MirrorFabsPool.sol";
import { MirrorLpRewards } from "../../../src/mining/soda/MirrorLpRewards.sol";
import { MirrorSodaPool } from "../../../src/mining/soda/MirrorSodaPool.sol";
import { DeployFabs } from "../../../script/DeployFabs.s.sol";

/// @dev Non-ERC20 fixture. Production mining/admission remains IGNIX's responsibility.
contract SeparateVaultFixture is ReentrancyGuard {
    bytes32 public constant LP_REWARDS_VERSION = keccak256("SodaDEX.MirrorEpochRewards.v1");
    bytes32 public constant FABS_HOOK_VERSION = keccak256("SodaDEX.FABS.VaultHook.v1");
    MockMiningFab public immutable FAB;
    FabsToken public immutable FABS;
    SodaPolicy public immutable POLICY;
    uint64 public openEpoch = 1;
    MirrorFabsPool public pool;
    MirrorLpRewards public rewards;
    uint256 public weight;
    uint256 public lastTime;
    mapping(address => uint256) public holderUnits;
    mapping(address => uint256) public settledAt;

    constructor(MockMiningFab fab, FabsToken token, SodaPolicy policy) {
        FAB = fab;
        FABS = token;
        POLICY = policy;
        lastTime = block.timestamp;
    }

    function bind(MirrorFabsPool value) external {
        require(address(pool) == address(0));
        pool = value;
        rewards = MirrorLpRewards(address(value.REWARDS()));
    }

    function totalEligibleWeight() external pure returns (uint256) {
        return 1;
    }

    function mint(address who, uint256 amount) external nonReentrant {
        FABS.mint(who, amount);
    }

    function burn(address who, uint256 amount) external nonReentrant {
        FABS.burn(who, amount);
    }

    function harvest() external nonReentrant {
        _sync();
    }

    function _sync() private {
        if (address(pool) == address(0)) return;
        weight += FABS.balanceOf(address(pool)) * (block.timestamp - lastTime);
        lastTime = block.timestamp;
        rewards.checkpoint(openEpoch, weight);
    }

    function _settle(address who) private {
        if (who == address(0)) return;
        holderUnits[who] += FABS.balanceOf(who) * (block.timestamp - settledAt[who]);
        settledAt[who] = block.timestamp;
    }

    // Intentionally not nonReentrant: mint/burn call back into this authenticated hook.
    function beforeFabsTransfer(address from, address to, uint256) external returns (bytes4) {
        require(msg.sender == address(FABS));
        _sync();
        _settle(from);
        _settle(to);
        return IFabsVault.beforeFabsTransfer.selector;
    }

    function close() external nonReentrant returns (uint64 e) {
        _sync();
        e = openEpoch;
        rewards.closeEpoch(e, weight);
        openEpoch++;
    }

    function fund(uint64 e, uint256 poolFab, uint256 incentive) external nonReentrant {
        FAB.mint(address(this), poolFab + incentive);
        FAB.approve(address(rewards), poolFab + incentive);
        rewards.notifyEpochRewards(e, poolFab, incentive);
    }
}

contract MirrorFabsPoolTest is Test {
    MockMiningFab fab;
    FabsToken token;
    SodaPolicy policy;
    SeparateVaultFixture vault;
    MirrorFabsPool pool;
    MirrorLpRewards rewards;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0x777);

    function setUp() public {
        vm.warp(1800000000);
        fab = new MockMiningFab();
        token = new FabsToken(address(this));
        policy = new SodaPolicy(address(this), treasury, IERC20(address(fab)));
        vault = new SeparateVaultFixture(fab, token, policy);
        token.bindVault(address(vault));
        pool = new MirrorFabsPool(SodaVault(address(vault)), treasury);
        vault.bind(pool);
        rewards = MirrorLpRewards(address(pool.REWARDS()));
        for (uint256 i; i < 2; i++) {
            address who = i == 0 ? alice : bob;
            vault.mint(who, 10000 ether);
            vm.deal(who, 100 ether);
            vm.prank(who);
            token.approve(address(pool), type(uint256).max);
        }
    }

    function wait(uint256 dt) private {
        vm.warp(block.timestamp + dt);
        vm.roll(block.number + 1);
    }

    function add(address who) private returns (uint256) {
        vm.prank(who);
        return pool.addLiquidity{ value: 1 ether }(100 ether, 0, 0, type(uint256).max);
    }

    function pending(address who) private view returns (uint256 f) {
        (f,) = rewards.claimable(who);
    }

    function test_separateTokenAddressAndBothSwapDirections() public {
        assertEq(address(pool.SHARES()), address(token));
        assertEq(address(pool.VAULT()), address(vault));
        assertEq(rewards.INCENTIVE_SOURCE(), address(vault));
        uint256 lp = add(alice);
        uint256 start = token.balanceOf(bob);
        vm.prank(bob);
        uint256 received = pool.swap{ value: 0.1 ether }(false, 0.1 ether, 0, type(uint256).max);
        assertEq(token.balanceOf(bob), start + received);
        vm.prank(bob);
        pool.swap(true, received, 0, type(uint256).max);
        (, uint256 okb) = rewards.claimable(alice);
        assertGt(okb, 0);
        uint256 beforeTreasury = treasury.balance;
        pool.INCOME().claimPlatformOkb();
        assertGt(treasury.balance, beforeTreasury);
        uint256 beforeShares = token.balanceOf(alice);
        vm.prank(alice);
        (uint256 shares,) = pool.removeLiquidity(lp, 0, 0, type(uint256).max);
        assertEq(token.balanceOf(alice), beforeShares + shares);
        assertEq(token.balanceOf(address(pool)), 0);
        assertEq(pool.reserveShares(), 0);
    }

    function test_delayedRewardsSurviveExitAndNewLpCannotTakeHistory() public {
        uint256 lp = add(alice);
        wait(100);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, type(uint256).max);
        wait(100);
        uint64 e = vault.close();
        add(bob);
        vault.fund(e, 100e8, 20e8);
        assertApproxEqAbs(pending(alice), 120e8, 2);
        assertEq(pending(bob), 0);
        rewards.claimFabFor(alice);
        assertApproxEqAbs(fab.balanceOf(alice), 120e8, 2);
    }

    function test_directFabsDonationPreservesHistoricalLpAndHolderIncome() public {
        uint256 lp = add(alice);
        wait(100);
        vm.prank(bob);
        token.transfer(address(pool), 100 ether);
        assertEq(vault.weight(), 100 ether * 100);
        assertEq(vault.holderUnits(bob), 10000 ether * 100);
        vm.prank(alice);
        pool.transfer(bob, lp);
        wait(100);
        uint64 e = vault.close();
        vault.fund(e, 300e8, 20e8);
        assertApproxEqAbs(pending(alice), 110e8, 2);
        assertApproxEqAbs(pending(bob), 210e8, 2);
    }

    function test_externalMintBurnHooksUnderVaultGuard() public {
        wait(100);
        uint256 supply = token.totalSupply();
        vault.burn(alice, 100 ether);
        assertEq(token.totalSupply(), supply - 100 ether);
        assertEq(vault.holderUnits(alice), 10000 ether * 100);
        vault.mint(alice, 100 ether);
        assertEq(token.totalSupply(), supply);
        vm.expectRevert();
        vault.beforeFabsTransfer(alice, bob, 1);
    }

    function test_poolRejectsUnboundToken() public {
        FabsToken unbound = new FabsToken(address(this));
        SeparateVaultFixture other = new SeparateVaultFixture(fab, unbound, policy);
        vm.expectRevert(MirrorSodaPool.IncompatibleVault.selector);
        new MirrorFabsPool(SodaVault(address(other)), treasury);
    }

    function test_deployScriptRejectsWrongChain() public {
        vm.chainId(1);
        DeployFabs script = new DeployFabs();
        vm.expectRevert("Expected X Layer 196");
        script.run();
    }

    function test_deployScriptProducesEmptyUnboundToken() public {
        vm.chainId(196);
        vm.setEnv("FABS_OWNER", "0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A");
        FabsToken deployed = new DeployFabs().run();
        assertEq(deployed.owner(), 0x6EFa1Fad18900B929Fe6782fd3eaBeac2563416A);
        assertEq(deployed.totalSupply(), 0);
        assertEq(deployed.vault(), address(0));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {CircuitMarket} from "fabx/src/market/CircuitMarket.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IRealPaidCounter} from "./FabFragmentRealIntegration.t.sol";
import {
    IMiningErc20, IActualMiningFactory, IActualMiningTaxVault, IActualMiningHolder,
    IActualMiningFarm, IActualV2Factory, IActualV2Router, MiningManagerIntegrationAdapter
} from "./MiningProductAbi.sol";

interface ICapTailFarm {
    function receiverSettledThrough(address vault) external view returns (uint64);
}

interface ICapTailHolder {
    function syncHistory(uint256 steps) external;
}

interface ICapTailSource {
    function rewardReceiptCount(bytes32 key, address recipient) external view returns (uint256);
}

/// @dev Actual FABX, CircuitMarket, Router02, V2 pairs, IgnixToken and mining products.
/// Uses a named manager adapter: bonding-curve/real graduation remains a separate gate.
contract FabMiningRealIntegrationTest is OkbBoostBase {
    IActualMiningFarm private farm;
    IActualMiningTaxVault private vault;
    IActualMiningHolder private tracker;
    IMiningErc20 private token;
    IActualV2Router private router;
    IActualV2Factory private v2Factory;
    MiningManagerIntegrationAdapter private manager;
    uint256 private minerId;
    bytes32 private key;
    bytes32 private leaderKey;
    uint256 private constant SIGNER_KEY = 0x1952;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        uint32 task = _addNotTask();
        leaderKey = _startVerified(alice, _tape(alice), task);
        minerId = _tape(bob);
        key = _startVerified(bob, minerId, task);
        string memory v2Artifacts = vm.envString("SODADEX_V2_ARTIFACT_ROOT");
        address wrapped = _deployV2(v2Artifacts, "WETH9", "");
        v2Factory = IActualV2Factory(_deployV2(v2Artifacts, "UniswapV2Factory", abi.encode(owner)));
        router = IActualV2Router(_deployV2(v2Artifacts, "UniswapV2Router02", abi.encode(v2Factory, wrapped)));
        vm.startPrank(owner);
        assertTrue(xmake.approve(address(router), 1_000e8));
        router.addLiquidityETH{value: 0.0001 ether}(address(xmake), 1_000e8, 0, 0, owner, vm.getBlockTimestamp());
        vm.stopPrank();
        manager = new MiningManagerIntegrationAdapter(address(router));
        string memory products = vm.envString("SODADEX_MINING_ARTIFACT_ROOT");
        IActualMiningFactory factory = IActualMiningFactory(deployCode(string.concat(products, "/MiningProjectFactory.sol/MiningProjectFactory.json"),
            abi.encode(xmake, manager, treasury, vm.addr(SIGNER_KEY), address(this), 5_000e8)));
        CircuitMarket implementation = new CircuitMarket();
        CircuitMarket market = CircuitMarket(address(new ERC1967Proxy(address(implementation),
            abi.encodeCall(CircuitMarket.initialize, (owner, circuits.factory(), treasury, uint16(0))))));
        farm = IActualMiningFarm(deployCode(string.concat(products, "/FabMiningFarm.sol/FabMiningFarm.json"),
            abi.encode(xmake, factory, pod, circuits, circuits.factory(), uint16(4), market, router, vm.addr(SIGNER_KEY))));
        factory.bindFarm(address(farm));
        token = IMiningErc20(deployCode(string.concat(products, "/IgnixToken.sol/IgnixToken.json"),
            abi.encode("SodaDEX TEST Mining Project", "TEST-A", manager)));
        vault = IActualMiningTaxVault(manager.createProject(address(factory), address(token), address(xmake), owner));
        tracker = IActualMiningHolder(vault.tracker());
        vm.prank(owner);
        assertTrue(xmake.transfer(address(vault), 100e8));
        vault.sync();
        vault.fundFarm();
        assertEq(farm.procurementBudget(), 99e8);
        vm.startPrank(bob);
        circuits.approve(address(market), minerId);
        uint256 listing = market.list(address(circuits), minerId, uint96(0.00000001 ether));
        vm.stopPrank();
        IActualMiningFarm.Purchase memory p = IActualMiningFarm.Purchase(listing, minerId, 0.00000001 ether, 1e8, 1, vm.getBlockTimestamp() + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, farm.purchaseDigest(p));
        farm.buyMiner(p, abi.encodePacked(r, s, v));
        assertEq(circuits.ownerOf(minerId), address(farm));
        vm.prank(owner);
        assertTrue(xmake.transfer(address(manager), 100e8));
        manager.seedProjectPool(address(token), address(xmake));
        manager.unlock(address(token), v2Factory.getPair(address(token), address(xmake)));
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
    }

    function _deployV2(string memory folder, string memory name, bytes memory args) private returns (address deployed) {
        bytes memory creation = vm.parseJsonBytes(vm.readFile(string.concat(folder, "/", name, ".json")), ".bytecode.object");
        bytes memory initcode = abi.encodePacked(creation, args);
        assembly { deployed := create(0, add(initcode, 32), mload(initcode)) }
        require(deployed.code.length != 0, "V2 component creation failed");
    }

    function test_realMarketAndNativeRouterPurchasePreservesPrincipalAndSellerOutput() public view {
        assertGt(farm.procurementSpent(), 0);
        assertLt(farm.procurementSpent(), 1e8);
        assertEq(farm.procurementBudget() + farm.procurementSpent(), 99e8);
        assertEq(xmake.allowance(address(farm), address(router)), 0);
        assertEq(bob.balance, 5_000 ether - circuits.TAPEOUT_FEE() + 0.00000001 ether);
    }

    function test_realTokenTransferKeepsOldMiningRewardsAndFutureIncomeGoesToNewHolder() public {
        manager.give(address(token), alice, 1_000 ether);
        vm.warp(vm.getBlockTimestamp() + 100);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 1_000 ether));
        assertGt(tracker.claimable(alice), 0);
        assertEq(tracker.claimable(bob), 0);
        vm.warp(vm.getBlockTimestamp() + 100);
        tracker.harvest();
        assertGt(tracker.claimable(bob), 0);
        uint256 before = xmake.balanceOf(alice);
        tracker.claimFor(alice);
        assertGt(xmake.balanceOf(alice), before);
        assertEq(farm.recognisedRewards(), IRealPaidCounter(address(pod)).paidTo(key, address(farm)));
    }

    function test_realSourceZeroHolderIncomeStaysParkedAfterFirstBuyer() public {
        vm.warp(vm.getBlockTimestamp() + 100);
        tracker.harvest();
        uint256 parked = tracker.parkedRewards();
        assertGt(parked, 0);
        manager.give(address(token), alice, 1_000 ether);
        assertEq(tracker.claimable(alice), 0);
        assertEq(tracker.parkedRewards(), parked);
        vm.warp(vm.getBlockTimestamp() + 100);
        tracker.harvest();
        assertGt(tracker.claimable(alice), 0);
    }

    function test_realTokenV2SellCollectsProjectTaxWithoutCreditingPoolAsHolder() public {
        address pair = v2Factory.getPair(address(token), address(xmake));
        manager.give(address(token), alice, 1_000 ether);
        address[] memory path = new address[](2);
        path[0] = address(token); path[1] = address(xmake);
        uint256 beforeTokenTax = token.balanceOf(address(vault));
        uint256 beforeFab = xmake.balanceOf(alice);
        vm.startPrank(alice);
        assertTrue(token.approve(address(router), 100 ether));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(100 ether, 1, path, alice, vm.getBlockTimestamp());
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)) - beforeTokenTax, 1 ether);
        assertGt(xmake.balanceOf(alice), beforeFab);
        assertTrue(tracker.excluded(pair));
        assertEq(tracker.weightOf(pair), 0);
    }

    function test_realSourceBurnExpiryUsesHistoricalIncomeAndCapClipping() public {
        manager.give(address(token), alice, 1_000 ether);
        manager.give(address(token), bob, 1_000 ether);
        vm.startPrank(alice);
        assertTrue(token.approve(address(tracker), 500 ether));
        tracker.burnForBoost(500 ether);
        vm.stopPrank();
        uint256 start = vm.getBlockTimestamp();
        uint256 lotIndex = tracker.nextIncomeLot();
        assertEq(tracker.weightOf(alice), 1_000 ether);
        assertEq(token.balanceOf(alice), 500 ether);
        vm.warp(start + 3 days);
        vm.prank(alice);
        pod.stop(leaderKey);
        vm.warp(start + 8 days);
        uint256 fill = xmake.MAX_SUPPLY() - xmake.totalSupply() - 101;
        vm.prank(address(pod));
        xmake.mint(owner, fill);
        tracker.harvest();
        assertEq(tracker.activeCredit(alice), 0);
        assertEq(tracker.weightOf(alice), 500 ether);
        assertEq(tracker.weightOf(bob), 1_000 ether);
        assertEq(farm.fundedLotCount(address(vault)), lotIndex + 1);
        (,uint256 actual) = farm.incomeLot(address(vault), lotIndex);
        uint256 early = farm.incomeLotThrough(address(vault), lotIndex, start + 7 days);
        assertGt(early, 0);
        assertLt(early, actual);
        uint256 beforeAlice = xmake.balanceOf(alice);
        uint256 beforeBob = xmake.balanceOf(bob);
        tracker.claimFor(alice);
        tracker.claimFor(bob);
        uint256 alicePaid = xmake.balanceOf(alice) - beforeAlice;
        uint256 bobPaid = xmake.balanceOf(bob) - beforeBob;
        assertApproxEqAbs(alicePaid, early / 2 + (actual - early) / 3, 2);
        assertApproxEqAbs(bobPaid, early / 2 + (actual - early) * 2 / 3, 2);
        assertLe(alicePaid + bobPaid, actual);
        assertEq(IRealPaidCounter(address(pod)).paidTo(key, address(farm)), farm.recognisedRewards());
    }

    function test_realSourceExhaustedCapDoesNotBlockExpiryTransferOrOldClaim() public {
        manager.give(address(token), alice, 1_000 ether);
        manager.give(address(token), bob, 1_000 ether);
        vm.startPrank(alice);
        assertTrue(token.approve(address(tracker), 500 ether));
        tracker.burnForBoost(500 ether);
        vm.stopPrank();
        uint256 start = vm.getBlockTimestamp();

        // First fund a positive entitlement that must survive supply exhaustion.
        vm.warp(start + 100);
        tracker.harvest();
        uint256 bookedAlice = tracker.claimable(alice);
        assertGt(bookedAlice, 0);
        uint256 paidBefore = IRealPaidCounter(address(pod)).paidTo(key, address(farm));
        uint256 receiptsBefore = ICapTailSource(address(pod)).rewardReceiptCount(key, address(farm));
        uint256 lotsBefore = farm.fundedLotCount(address(vault));
        uint256 farmRecognisedBefore = farm.recognisedRewards();
        uint256 holderRecognisedBefore = tracker.recognisedRewards();
        assertEq(tracker.nextIncomeLot(), lotsBefore);

        // Fixture-only mint authority, as in the existing clipping regression.
        uint256 fill = xmake.MAX_SUPPLY() - xmake.totalSupply();
        vm.prank(address(pod));
        xmake.mint(owner, fill);
        assertEq(xmake.totalSupply(), xmake.MAX_SUPPLY());

        vm.warp(start + 8 days);
        pod.poke();
        assertGt(pod.pending(key), 0);
        farm.harvest();
        assertEq(pod.pending(key), 0);
        assertEq(IRealPaidCounter(address(pod)).paidTo(key, address(farm)), paidBefore);
        assertEq(tracker.activeCredit(alice), 500 ether);
        ICapTailHolder(address(tracker)).syncHistory(1);
        assertEq(ICapTailFarm(address(farm)).receiverSettledThrough(address(vault)), vm.getBlockTimestamp());
        assertEq(tracker.activeCredit(alice), 0);
        assertEq(tracker.weightOf(alice), 500 ether);
        assertEq(tracker.weightOf(bob), 1_000 ether);
        assertEq(tracker.claimable(alice), bookedAlice);

        // Zero new gross at the same timestamp must also remain callable.
        tracker.harvest();
        assertEq(pod.pending(key), 0);

        // Real token callbacks settle later positive gross with zero actual FAB.
        vm.warp(start + 8 days + 100);
        pod.poke();
        assertGt(pod.pending(key), 0);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 1 ether));
        ICapTailHolder(address(tracker)).syncHistory(1);
        assertEq(pod.pending(key), 0);
        assertEq(tracker.weightOf(alice), 499 ether);
        assertEq(tracker.weightOf(bob), 1_001 ether);
        assertEq(ICapTailFarm(address(farm)).receiverSettledThrough(address(vault)), vm.getBlockTimestamp());
        assertEq(farm.fundedLotCount(address(vault)), lotsBefore);
        assertEq(tracker.nextIncomeLot(), lotsBefore);
        assertEq(farm.recognisedRewards(), farmRecognisedBefore);
        assertEq(tracker.recognisedRewards(), holderRecognisedBefore);
        assertEq(IRealPaidCounter(address(pod)).paidTo(key, address(farm)), paidBefore);
        assertEq(ICapTailSource(address(pod)).rewardReceiptCount(key, address(farm)), receiptsBefore);

        uint256 beforeAlice = xmake.balanceOf(alice);
        assertEq(tracker.claimFor(alice), bookedAlice);
        assertEq(xmake.balanceOf(alice) - beforeAlice, bookedAlice);
        assertEq(xmake.totalSupply(), xmake.MAX_SUPPLY());
    }

    function test_realSourcePauseBlocksProjectTransferButKeepsBookedClaim() public {
        manager.give(address(token), alice, 1_000 ether);
        vm.warp(vm.getBlockTimestamp() + 100);
        tracker.harvest();
        assertGt(tracker.claimable(alice), 0);
        vm.prank(owner);
        pod.pause();
        vm.expectRevert(bytes4(keccak256("MiningUnavailable()")));
        vm.prank(alice);
        // The expected revert is the observable result; no success value exists.
        token.transfer(bob, 1 ether);
        uint256 before = xmake.balanceOf(alice);
        tracker.claimFor(alice);
        assertGt(xmake.balanceOf(alice), before);
    }
}

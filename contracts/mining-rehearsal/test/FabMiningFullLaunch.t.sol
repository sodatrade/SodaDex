// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";
import {CircuitMarket} from "fabx/src/market/CircuitMarket.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IMiningErc20, IActualMiningFactory, IActualMiningTaxVault, IActualMiningHolder,
    IActualMiningFarm, IActualV2Factory, IActualV2Router} from "./MiningProductAbi.sol";
import {IMiningLaunchManager, IMiningLaunchRegistry, IMiningV2Pair,
    IMiningV2Locker, IMiningLiquidityHelper, MiningCreate2Deployer} from "./MiningLaunchAbi.sol";
import {IRealFragmentVault, IRealFragmentPool} from "./FabFragmentRealIntegration.t.sol";

/// @dev Genuine Manager, signature admission, curve, V2 graduation and FABX custody.
/// Every protocol dependency runs constructor bytecode. No RPC, etch or manager adapter.
contract FabMiningFullLaunchTest is OkbBoostBase {
    uint256 private constant SIGNER_KEY = 0x1952;
    uint256 private constant GRADUATION = 5_000e8;
    IMiningLaunchManager private manager;
    IActualV2Router private router;
    IActualV2Factory private v2Factory;
    IActualMiningFarm private farm;
    IActualMiningFactory private factory;
    CircuitMarket private market;
    address private v2Locker;
    address private liquidityHelper;
    uint256 private minerId;
    uint32 private taskId;
    address private fixtureToken;

    function setUp() public override {
        vm.chainId(1952);
        super.setUp();
        uint32 task = _addNotTask();
        taskId = task;
        _startVerified(alice, _tape(alice), task);
        minerId = _tape(bob);
        _startVerified(bob, minerId, task);
        string memory v2 = vm.envString("SODADEX_V2_ARTIFACT_ROOT");
        address wrapped = _createFrom(v2, "WETH9", "");
        v2Factory = IActualV2Factory(_createFrom(v2, "UniswapV2Factory", abi.encode(owner)));
        router = IActualV2Router(_createFrom(v2, "UniswapV2Router02", abi.encode(v2Factory, wrapped)));
        vm.startPrank(owner);
        assertTrue(xmake.approve(address(router), 1_000e8));
        router.addLiquidityETH{value: 0.0001 ether}(address(xmake), 1_000e8, 0, 0, owner, vm.getBlockTimestamp());
        vm.stopPrank();
        address registry = _configureManager(wrapped);
        factory = IActualMiningFactory(_create("MiningProjectFactory",
            abi.encode(xmake, manager, treasury, vm.addr(SIGNER_KEY), address(this), GRADUATION)));
        market = CircuitMarket(address(new ERC1967Proxy(address(new CircuitMarket()),
            abi.encodeCall(CircuitMarket.initialize, (owner, circuits.factory(), treasury, uint16(0))))));
        farm = IActualMiningFarm(_create("FabMiningFarm", abi.encode(xmake, factory, pod, circuits,
            circuits.factory(), uint16(4), market, router, vm.addr(SIGNER_KEY))));
        factory.bindFarm(address(farm));
        IMiningLaunchRegistry(registry).setTemplate(0, address(factory));
    }

    function _configureManager(address wrapped) private returns (address registry) {
        address pm = _create("PoolManager", abi.encode(address(this)));
        address permit = _create("Permit2", "");
        address descriptor = _create("PositionDescriptor", abi.encode(pm, wrapped, bytes32("OKB")));
        address positionManager = _create("PositionManager", abi.encode(pm, permit, uint256(300_000), descriptor, wrapped));
        address quoter = _create("V4Quoter", abi.encode(pm));
        registry = _create("VaultRegistry", abi.encode(address(this)));
        address launchFactory = _create("IgnixLaunchFactory", "");
        address implementation = _createLinkedManager();
        manager = IMiningLaunchManager(address(new ERC1967Proxy(implementation,
            abi.encodeCall(IMiningLaunchManager.initialize, (address(this), pm, positionManager, permit,
                registry, launchFactory, uint24(0), int24(1), vm.addr(SIGNER_KEY))))));
        address lpLocker = _create("IgnixLpLocker", abi.encode(manager, pm, positionManager));
        v2Locker = _create("IgnixV2Locker", abi.encode(manager));
        address helper = _create("IgnixLiquidityHelper", abi.encode(manager, v2Factory, router, wrapped));
        liquidityHelper = helper;
        address protectionRouter = _create("IgnixV4Router", abi.encode(manager, pm, permit));
        MiningCreate2Deployer deployer = new MiningCreate2Deployer();
        bytes memory initcode = abi.encodePacked(_creation("IgnixPoolGuard"), abi.encode(pm, manager, protectionRouter, quoter));
        bytes32 codeHash = keccak256(initcode);
        address hook;
        for (uint256 i; ; ++i) {
            address expected = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(deployer), bytes32(i), codeHash)))));
            if (uint160(expected) & 0x3fff == 0x2080) {
                hook = deployer.deploy(bytes32(i), initcode);
                assertEq(hook, expected);
                break;
            }
        }
        manager.configure(hook, lpLocker);
        manager.configure2(address(v2Factory), address(router), v2Locker, wrapped, helper);
    }

    function test_realSignedLaunchFundsMinerBeforeGraduationThenTradesGraduatedV2() public {
        IMiningErc20 token = IMiningErc20(_launch());
        fixtureToken = address(token);
        IActualMiningTaxVault vault = IActualMiningTaxVault(manager.vaultOf(address(token)));
        IActualMiningHolder tracker = IActualMiningHolder(vault.tracker());
        assertEq(token.balanceOf(address(manager)), 1_000_000_000 ether);
        vm.prank(owner);
        assertTrue(xmake.transfer(alice, 7_000e8));
        vm.startPrank(alice);
        assertTrue(xmake.approve(address(manager), 7_000e8));
        manager.buy(address(token), GRADUATION / 10, 1);
        uint256 bought = token.balanceOf(alice);
        assertGt(bought, 0);
        assertEq(xmake.balanceOf(address(vault)), 5e8, "curve project tax is actual FAB");
        assertEq(manager.platformAccrued(address(xmake)), 5e8);
        assertTrue(token.approve(address(manager), bought / 2));
        manager.sell(address(token), bought / 2, 1);
        vm.stopPrank();
        vault.sync();
        vault.fundFarm();
        assertGt(farm.procurementBudget(), 4e8);
        _purchase();
        assertEq(circuits.ownerOf(minerId), address(farm));
        vm.warp(vm.getBlockTimestamp() + 100);
        tracker.harvest();
        uint256 before = xmake.balanceOf(alice);
        tracker.claimFor(alice);
        assertGt(xmake.balanceOf(alice), before, "pre-graduation holder earns real miner output");
        IMiningLaunchManager.TokenState memory state = _tokenState(address(token));
        uint256 left = uint256(state.sellable) - state.sold;
        uint256 requiredNet = _ceil(uint256(state.vQuote) * left, uint256(state.vToken) - left);
        uint256 gross = _ceil(requiredNet * 10_000, 9_800);
        vm.prank(alice);
        manager.buy(address(token), gross, left);
        state = _tokenState(address(token));
        address pair = manager.pairOf(address(token));
        assertEq(state.sold, state.sellable);
        assertEq(pair, v2Factory.getPair(address(token), address(xmake)));
        assertTrue(pair != address(0));
        assertEq(state.poolId, bytes32(0));
        assertGt(IMiningV2Pair(pair).balanceOf(v2Locker), 0);
        assertGt(IMiningV2Locker(v2Locker).baselineOf(pair), 0);
        assertTrue(tracker.excluded(pair));
        assertEq(tracker.weightOf(pair), 0);
        (uint112 reserve0,uint112 reserve1,) = IMiningV2Pair(pair).getReserves();
        bool tokenFirst = IMiningV2Pair(pair).token0() == address(token);
        assertEq(tokenFirst ? reserve0 : reserve1, state.reserve);
        assertEq(tokenFirst ? reserve1 : reserve0, state.collected);
        // The approved liquidity-only channel must work during the mandatory protection day.
        _exerciseLiquidity(token, pair);
        // Mining's taxed V2 path also supports real swaps during the protection window.
        assertTrue(_boolGetter(address(token), "protectionActive()"));
        _tradeBothDirections(token);
        vm.warp(vm.getBlockTimestamp() + 1 days + 1);
        _tradeBothDirections(token);
        assertGt(token.balanceOf(address(vault)), 0, "graduated V2 trades pay project token tax");
        _collectLockedLpFees(pair);
        uint256 input = token.balanceOf(address(vault));
        IActualMiningTaxVault.Conversion memory conversion = IActualMiningTaxVault.Conversion(input, 1, 1, vm.getBlockTimestamp() + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, vault.conversionDigest(conversion));
        uint256 fabBefore = xmake.balanceOf(address(vault));
        uint256 budgetBefore = farm.procurementBudget();
        vault.convertTax(conversion, abi.encodePacked(r,s,v));
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.allowance(address(vault), address(router)), 0);
        assertGt(xmake.balanceOf(address(vault)), fabBefore);
        vault.sync();
        vault.fundFarm();
        assertGt(farm.procurementBudget(), budgetBefore);
    }

    function _tradeBothDirections(IMiningErc20 token) private {
        address[] memory path = new address[](2);
        path[0] = address(xmake); path[1] = address(token);
        vm.startPrank(alice);
        assertTrue(xmake.approve(address(router), 1e8));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(1e8, 1, path, alice, vm.getBlockTimestamp());
        path[0] = address(token); path[1] = address(xmake);
        assertTrue(token.approve(address(router), 1 ether));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(1 ether, 1, path, alice, vm.getBlockTimestamp());
        vm.stopPrank();
    }

    function _boolGetter(address target, string memory signature) private view returns (bool) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(signature));
        require(ok, "Fixture bool getter failed");
        return abi.decode(data, (bool));
    }

    /// @dev Explicit loopback browser fixture export; never runs in ordinary acceptance.
    function test_exportBrowserFixture() public {
        string memory output = vm.envString("SODADEX_MINING_BROWSER_OUTPUT");
        require(bytes(output).length != 0, "Explicit fixture output required");
        // dumpState includes changes in this frame: deploy the complete real stack here.
        setUp();
        test_realSignedLaunchFundsMinerBeforeGraduationThenTradesGraduatedV2();
        IRealFragmentVault fragment = IRealFragmentVault(_create("FabFragmentVault",
            abi.encode(xmake, pod, circuits, circuits.factory(), uint16(4))));
        IRealFragmentPool fragmentPool = IRealFragmentPool(_create("FabFragmentPool", abi.encode(fragment, treasury)));
        uint256 deposited = _tape(bob);
        _startVerified(bob, deposited, taskId);
        uint256 available = _tape(alice);
        _startVerified(alice, available, taskId);
        uint256 retail = _tape(bob);
        _startVerified(bob, retail, taskId);
        vm.prank(owner);
        assertTrue(xmake.transfer(bob, 1_000e8));
        vm.startPrank(bob);
        circuits.approve(address(fragment), deposited);
        fragment.deposit(deposited, 1);
        assertTrue(fragment.approve(address(fragmentPool), 3_000 ether));
        assertTrue(xmake.approve(address(fragmentPool), 300e8));
        fragmentPool.addLiquidity(3_000 ether, 300e8, 1, 1, vm.getBlockTimestamp());
        circuits.approve(address(market), retail);
        uint256 retailListing = market.list(address(circuits), retail, uint96(0.00000001 ether));
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 100);
        fragmentPool.harvest();
        vm.deal(alice, 1 ether);
        vm.serializeAddress("fixture", "account", alice);
        vm.serializeAddress("fixture", "fab", address(xmake));
        vm.serializeAddress("fixture", "mining", address(pod));
        vm.serializeAddress("fixture", "circuits", address(circuits));
        vm.serializeAddress("fixture", "circuitMarket", address(market));
        vm.serializeAddress("fixture", "nftFactory", circuits.factory());
        vm.serializeAddress("fixture", "manager", address(manager));
        vm.serializeAddress("fixture", "launchFactory", manager.LAUNCH_FACTORY());
        vm.serializeAddress("fixture", "registry", _addressGetter(address(manager), "REGISTRY()"));
        vm.serializeAddress("fixture", "miningFactory", address(factory));
        vm.serializeAddress("fixture", "farm", address(farm));
        vm.serializeAddress("fixture", "router", address(router));
        vm.serializeAddress("fixture", "v2Factory", address(v2Factory));
        vm.serializeAddress("fixture", "wrappedNative", _addressGetter(address(router), "WETH()"));
        vm.serializeAddress("fixture", "v2Locker", v2Locker);
        vm.serializeAddress("fixture", "liquidityHelper", liquidityHelper);
        vm.serializeAddress("fixture", "fragmentVault", address(fragment));
        vm.serializeAddress("fixture", "fragmentPool", address(fragmentPool));
        vm.serializeAddress("fixture", "minerBuyer", _create("FabMinerTestBuyer", abi.encode(market, fragment)));
        vm.serializeAddress("fixture", "projectToken", fixtureToken);
        address vault = manager.vaultOf(fixtureToken);
        vm.serializeAddress("fixture", "projectVault", vault);
        vm.serializeAddress("fixture", "projectHolder", IActualMiningTaxVault(vault).tracker());
        vm.serializeAddress("fixture", "projectPair", manager.pairOf(fixtureToken));
        vm.serializeUint("fixture", "minerId", available);
        vm.serializeUint("fixture", "testListingId", retailListing);
        vm.serializeUint("fixture", "timestamp", vm.getBlockTimestamp());
        string memory data = vm.serializeUint("fixture", "templateId", 0);
        vm.writeJson(data, string.concat(output, "/addresses.json"));
        vm.dumpState(string.concat(output, "/state.json"));
    }

    function _addressGetter(address target, string memory signature) private view returns (address) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(signature));
        require(ok, "Fixture address getter failed");
        return abi.decode(data, (address));
    }

    function _collectLockedLpFees(address pair) private {
        IMiningV2Locker locker = IMiningV2Locker(v2Locker);
        uint256 baseline = locker.baselineOf(pair);
        assertGt(locker.harvest(pair), 0, "real swap fees can be harvested without removing principal");
        assertEq(locker.baselineOf(pair), baseline);
        uint256 platformIncome = locker.platformAccrued(address(xmake));
        uint256 creatorIncome = locker.accrued(owner, address(xmake));
        assertGt(platformIncome, 0);
        assertApproxEqAbs(platformIncome, creatorIncome, 1);
        uint256 beforePlatform = xmake.balanceOf(address(this));
        uint256 beforeCreator = xmake.balanceOf(owner);
        locker.claimPlatform(address(xmake));
        vm.prank(owner);
        locker.claim(address(xmake));
        assertEq(xmake.balanceOf(address(this)) - beforePlatform, platformIncome);
        assertEq(xmake.balanceOf(owner) - beforeCreator, creatorIncome);
    }

    function _exerciseLiquidity(IMiningErc20 token, address pair) private {
        vm.startPrank(alice);
        assertTrue(token.approve(liquidityHelper, 1_000_000 ether));
        assertTrue(xmake.approve(liquidityHelper, 1e8));
        (,,uint256 liquidity) = IMiningLiquidityHelper(liquidityHelper)
            .addLiquidity(address(token), 1_000_000 ether, 1e8, 0, 0, vm.getBlockTimestamp());
        assertGt(liquidity, 0);
        assertEq(IMiningV2Pair(pair).balanceOf(alice), liquidity);
        assertTrue(IMiningErc20(pair).approve(liquidityHelper, liquidity));
        uint256 tokenBefore = token.balanceOf(alice);
        uint256 fabBefore = xmake.balanceOf(alice);
        IMiningLiquidityHelper(liquidityHelper).removeLiquidity(address(token), liquidity, 0, 0, vm.getBlockTimestamp());
        assertEq(IMiningV2Pair(pair).balanceOf(alice), 0);
        assertGt(token.balanceOf(alice), tokenBefore);
        assertGt(xmake.balanceOf(alice), fabBefore);
        vm.stopPrank();
    }

    function _launch() private returns (address) {
        IMiningLaunchManager.CreateParams memory p;
        p.name = "SodaDEX TEST FAB Mining"; p.symbol = "TEST-A";
        p.salt = keccak256("full-real-launch-1952"); p.quote = address(xmake);
        p.graduation = GRADUATION; p.buyFeeBps = 100; p.sellFeeBps = 100;
        p.taxBuyBps = 100; p.taxSellBps = 100;
        bytes memory data = abi.encode(uint16(100), uint16(100), uint16(100), uint16(0));
        uint64 deadline = uint64(vm.getBlockTimestamp() + 1 hours);
        bytes32 payload = keccak256(abi.encode(block.chainid, address(manager), owner, p, uint16(0), data,
            deadline, address(factory), uint8(1), uint64(1 days), manager.POOL_FEE(), manager.LAUNCH_FACTORY()));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payload)));
        vm.prank(owner);
        return manager.createToken(p, 0, data, deadline, address(factory), 1, 1 days, abi.encodePacked(r,s,v));
    }

    function _purchase() private {
        vm.startPrank(bob);
        circuits.approve(address(market), minerId);
        uint256 listing = market.list(address(circuits), minerId, uint96(0.00000001 ether));
        vm.stopPrank();
        IActualMiningFarm.Purchase memory p = IActualMiningFarm.Purchase(listing, minerId,
            0.00000001 ether, 1e8, 1, vm.getBlockTimestamp() + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, farm.purchaseDigest(p));
        farm.buyMiner(p, abi.encodePacked(r,s,v));
    }

    function _tokenState(address token) private view returns (IMiningLaunchManager.TokenState memory) {
        (bool ok, bytes memory data) = address(manager).staticcall(abi.encodeWithSignature("tokens(address)", token));
        require(ok, "Manager token read");
        return abi.decode(data, (IMiningLaunchManager.TokenState));
    }

    function _createLinkedManager() private returns (address) {
        string memory file = vm.readFile(_path("IgnixManager"));
        bytes memory creation = vm.parseJsonBytes(file, ".bytecode.object");
        string[3] memory names = ["CurveTrading", "LaunchLogic", "V2Graduation"];
        for (uint256 i; i < names.length; ++i) {
            address libraryAddress = _create(names[i], "");
            uint256[] memory offsets = vm.parseJsonUintArray(file, string.concat(".sodadexLibraries.", names[i]));
            for (uint256 j; j < offsets.length; ++j) {
                for (uint256 k; k < 20; ++k) creation[offsets[j] + k] = bytes20(libraryAddress)[k];
            }
        }
        return _deploy(creation);
    }

    function _ceil(uint256 a, uint256 b) private pure returns (uint256) { return a / b + (a % b == 0 ? 0 : 1); }
    function _path(string memory name) private view returns (string memory) {
        return string.concat(vm.envString("SODADEX_MINING_ARTIFACT_ROOT"), "/", name, ".sol/", name, ".json");
    }
    function _creation(string memory name) private view returns (bytes memory) {
        return vm.parseJsonBytes(vm.readFile(_path(name)), ".bytecode.object");
    }
    function _create(string memory name, bytes memory args) private returns (address) {
        return _deploy(abi.encodePacked(_creation(name), args));
    }
    function _createFrom(string memory folder, string memory name, bytes memory args) private returns (address) {
        return _deploy(abi.encodePacked(vm.parseJsonBytes(vm.readFile(string.concat(folder, "/", name, ".json")), ".bytecode.object"), args));
    }
    function _deploy(bytes memory initcode) private returns (address deployed) {
        assembly { deployed := create(0, add(initcode,32),mload(initcode)) }
        require(deployed.code.length != 0, "Artifact constructor failed");
    }
}

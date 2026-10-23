// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {SodaLimitSettlement} from "../src/SodaLimitSettlement.sol";
import {IPermit2} from "../src/Interfaces.sol";
import {CanonicalRouter} from "../src/CanonicalRouter.sol";
import {OrderHash} from "../src/OrderHash.sol";
import {SodaLimitOrder, PoolKey} from "../src/OrderTypes.sol";
import {
    MockToken,
    MockRouter,
    MockFactory,
    MockPool,
    MockStateView,
    IPermitAllowance,
    ReentrantReceiver,
    SmartMaker
} from "./Mocks.sol";

interface INonceBitmap {
    function nonceBitmap(address, uint256) external view returns (uint256);
}

contract SettlementTest is Test {
    uint256 constant KEY = 0xA11CE;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant ROUTER = 0xda5Bc8bc981d9b2F5df2b0c7E5aeD044993709FA;
    address constant FACTORY = 0xa6109B7F4237d2aC28B8009FbD21B88cff194cFe;
    address constant MANAGER = 0x6B5C32aD97EB42230138e02a21B0E6d811FD713D;
    address constant VIEW = 0x7991D4a8493b9709365cD079DfFc75e790007874;
    address constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    SodaLimitSettlement internal settlement;
    MockToken internal input;
    MockToken internal output;
    address internal maker;
    address internal receiver;
    bytes32 internal domain;
    uint256 internal nextNonce = 1;
    uint256 internal expectedSpent;
    uint256 internal expectedOutput;

    function setUp() public {
        vm.chainId(196);
        vm.warp(1000);
        maker = vm.addr(KEY);
        receiver = address(0xB0B);
        vm.etch(
            PERMIT2, vm.parseJsonBytes(vm.readFile("../../.analysis/orders/fixtures/permit2-runtime.json"), ".runtime")
        );
        vm.etch(ROUTER, address(new MockRouter()).code);
        vm.deal(ROUTER, 100 ether);
        vm.etch(FACTORY, address(new MockFactory()).code);
        MockFactory(FACTORY).setPool(address(new MockPool()));
        vm.etch(MANAGER, address(new MockPool()).code);
        vm.etch(VIEW, address(new MockStateView()).code);
        vm.etch(WOKB, address(new MockToken()).code);
        input = new MockToken();
        output = new MockToken();
        input.mint(maker, 1e30);
        vm.prank(maker);
        input.approve(PERMIT2, type(uint256).max);
        settlement = new SodaLimitSettlement();
        domain = IPermit2(PERMIT2).DOMAIN_SEPARATOR();
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = this.handlerFill.selector;
        targetSelector(FuzzSelector(address(this), selectors));
        targetContract(address(this));
    }

    function _order(uint8 protocol, uint256 nonce, address out) internal view returns (SodaLimitOrder memory o) {
        address poolOut = protocol == 3 && out == address(0) ? WOKB : out;
        (address a, address b) = address(input) < poolOut ? (address(input), poolOut) : (poolOut, address(input));
        o = SodaLimitOrder(
            196,
            address(settlement),
            maker,
            address(input),
            out,
            100,
            1000,
            receiver,
            nonce,
            2000,
            protocol,
            PoolKey(a, b, 100, 1, address(0))
        );
    }

    function _signature(SodaLimitOrder memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(KEY, keccak256(abi.encodePacked("\x19\x01", domain, OrderHash.permitHash(o))));
        return abi.encodePacked(r, s, v);
    }

    function _configure(SodaLimitOrder memory o, uint256 produced) internal {
        MockRouter(ROUTER).configure(o.inputToken, o.outputToken, o.amountIn, produced);
    }

    function _assertNoApproval() internal {
        assertEq(input.allowance(address(settlement), PERMIT2), 0);
        (uint160 a,,) = IPermitAllowance(PERMIT2).allowance(address(settlement), address(input), ROUTER);
        assertEq(a, 0);
    }

    function testERC1271MakerUsesTheSameWitnessAndExactInput() public {
        SmartMaker wallet = new SmartMaker();
        input.mint(address(wallet), 100);
        wallet.approveToken(address(input), PERMIT2, 100);
        SodaLimitOrder memory o = _order(4, 41, address(output));
        o.maker = address(wallet);
        _configure(o, 1000);
        wallet.setDigest(settlement.orderDigest(o));
        settlement.execute(o, hex"1234");
        assertEq(input.balanceOf(address(wallet)), 0);
        assertEq(output.balanceOf(receiver), 1000);
        assertEq(uint8(settlement.nonceStatus(address(wallet), 41)), 2);
    }

    function testAnotherSettlementAndChainCannotReplayWitness() public {
        SodaLimitOrder memory o = _order(3, 42, address(output));
        _configure(o, 1000);
        bytes memory sig = _signature(o);
        SodaLimitSettlement other = new SodaLimitSettlement();
        vm.expectRevert(SodaLimitSettlement.WrongDeployment.selector);
        other.execute(o, sig);
        o.settlement = address(other);
        vm.expectRevert();
        other.execute(o, sig);
        assertEq(INonceBitmap(PERMIT2).nonceBitmap(maker, 0), 0);
        o.settlement = address(settlement);
        vm.chainId(197);
        vm.expectRevert(SodaLimitSettlement.WrongDeployment.selector);
        settlement.execute(o, sig);
        vm.chainId(196);
        settlement.execute(o, sig);
    }

    function testV3CanonicalFullFillAndCleanup() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        vm.prank(address(0xC0FFEE));
        assertEq(settlement.execute(o, _signature(o)), 1000);
        assertEq(input.balanceOf(maker), 1e30 - 100);
        assertEq(output.balanceOf(receiver), 1000);
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 2);
        _assertNoApproval();
        assertEq(MockRouter(ROUTER).lastCommands(), hex"00");
        (address recipient, uint256 amount, uint256 minimum, bytes memory path, bool payer, uint256[] memory hop) =
            abi.decode(MockRouter(ROUTER).inputAt(0), (address, uint256, uint256, bytes, bool, uint256[]));
        assertEq(recipient, address(settlement));
        assertEq(amount, 100);
        assertEq(minimum, 1000);
        assertEq(path, abi.encodePacked(address(input), uint24(100), address(output)));
        assertTrue(payer);
        assertEq(hop.length, 0);
    }

    function testV4CanonicalAndActualReceiver() public {
        SodaLimitOrder memory o = _order(4, 2, address(output));
        _configure(o, 1010);
        settlement.execute(o, _signature(o));
        assertEq(output.balanceOf(receiver), 1010);
        assertEq(MockRouter(ROUTER).lastCommands(), hex"10");
        (bytes memory actions, bytes[] memory params) = abi.decode(MockRouter(ROUTER).inputAt(0), (bytes, bytes[]));
        assertEq(actions, hex"060c0f");
        (CanonicalRouter.ExactInputSingleParams memory single) =
            abi.decode(params[0], (CanonicalRouter.ExactInputSingleParams));
        assertEq(single.amountIn, o.amountIn);
        assertEq(single.amountOutMinimum, o.minAmountOut);
        assertEq(single.hookData.length, 0);
        _assertNoApproval();
    }

    function testNativeOutputV3AndV4() public {
        for (uint8 p = 3; p <= 4; p++) {
            SodaLimitOrder memory o = _order(p, p, address(0));
            _configure(o, 1000);
            uint256 before = receiver.balance;
            settlement.execute(o, _signature(o));
            assertEq(receiver.balance - before, 1000);
            assertEq(address(settlement).balance, 0);
        }
    }

    function testReplayAndTerminalCancel() public {
        SodaLimitOrder memory o = _order(3, 7, address(output));
        _configure(o, 1000);
        bytes memory sig = _signature(o);
        settlement.execute(o, sig);
        vm.expectRevert(SodaLimitSettlement.NonceUnavailable.selector);
        settlement.execute(o, sig);
        vm.prank(maker);
        vm.expectRevert(SodaLimitSettlement.NonceUnavailable.selector);
        settlement.cancel(7);
    }

    function testCancelBlocksSignedOrderAndNotAnotherMaker() public {
        SodaLimitOrder memory o = _order(3, 7, address(output));
        bytes memory sig = _signature(o);
        vm.prank(address(123));
        settlement.cancel(7);
        assertEq(uint8(settlement.nonceStatus(maker, 7)), 0);
        vm.prank(maker);
        settlement.cancel(7);
        vm.expectRevert(SodaLimitSettlement.NonceUnavailable.selector);
        settlement.execute(o, sig);
        assertEq(uint8(settlement.nonceStatus(maker, 7)), 1);
    }

    function testExpiredAtExactBoundary() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        bytes memory sig = _signature(o);
        vm.warp(o.expiry);
        vm.expectRevert(SodaLimitSettlement.Expired.selector);
        settlement.execute(o, sig);
    }

    function testOutputFailureRollsBackNonceAndCanRetry() public {
        SodaLimitOrder memory o = _order(3, 255, address(output));
        _configure(o, 999);
        bytes memory sig = _signature(o);
        vm.expectRevert(SodaLimitSettlement.OutputAmountMismatch.selector);
        settlement.execute(o, sig);
        assertEq(uint8(settlement.nonceStatus(maker, 255)), 0);
        assertEq(INonceBitmap(PERMIT2).nonceBitmap(maker, 0), 0);
        assertEq(input.balanceOf(maker), 1e30);
        _configure(o, 1000);
        settlement.execute(o, sig);
        assertEq(uint8(settlement.nonceStatus(maker, 255)), 2);
    }

    function testInputFOTAndPartialSpendRevertAtomically() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        input.configure(100, 0, false);
        bytes memory sig = _signature(o);
        vm.expectRevert(SodaLimitSettlement.InputAmountMismatch.selector);
        settlement.execute(o, sig);
        assertEq(input.balanceOf(maker), 1e30);
        input.configure(0, 0, false);
        MockRouter(ROUTER).configure(o.inputToken, o.outputToken, 99, 1000);
        vm.expectRevert(SodaLimitSettlement.InputAmountMismatch.selector);
        settlement.execute(o, sig);
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 0);
    }

    function testSenderChargedInputFeeIsRejectedBeforeRouting() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        input.configureSenderFee(maker, 100);
        bytes memory sig = _signature(o);
        vm.expectRevert(SodaLimitSettlement.InputAmountMismatch.selector);
        settlement.execute(o, sig);
        assertEq(input.balanceOf(maker), 1e30);
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 0);
    }

    function testOutputFOTMeasuredAtReceiver() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        output.configure(0, 100, false);
        vm.expectRevert(SodaLimitSettlement.OutputAmountMismatch.selector);
        settlement.execute(o, _signature(o));
        assertEq(output.balanceOf(receiver), 0);
        assertEq(input.balanceOf(maker), 1e30);
    }

    function testMakerRouterAllowanceCannotAuthorizeKeeper() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        vm.startPrank(maker);
        input.approve(PERMIT2, 0);
        input.approve(ROUTER, 100);
        vm.stopPrank();
        vm.expectRevert();
        settlement.execute(o, _signature(o));
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 0);
    }

    function testSignedReceiverAndPoolAndAmountsCannotChange() public {
        SodaLimitOrder memory original = _order(3, 1, address(output));
        _configure(original, 1001);
        bytes memory sig = _signature(original);
        SodaLimitOrder memory changed = _order(3, 1, address(output));
        changed.receiver = address(123);
        vm.expectRevert();
        settlement.execute(changed, sig);
        changed = _order(3, 1, address(output));
        changed.amountIn++;
        vm.expectRevert();
        settlement.execute(changed, sig);
        changed = _order(3, 1, address(output));
        changed.minAmountOut++;
        vm.expectRevert();
        settlement.execute(changed, sig);
        changed = _order(3, 1, address(output));
        changed.pool.fee = 500;
        changed.pool.tickSpacing = 10;
        vm.expectRevert();
        settlement.execute(changed, sig);
        assertEq(input.balanceOf(maker), 1e30);
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 0);
    }

    function testDomainChainSettlementHookAndLimitsReject() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        bytes memory sig = _signature(o);
        o.chainId = 1;
        vm.expectRevert(SodaLimitSettlement.WrongDeployment.selector);
        settlement.execute(o, sig);
        o = _order(3, 1, address(output));
        o.settlement = address(999);
        vm.expectRevert(SodaLimitSettlement.WrongDeployment.selector);
        settlement.execute(o, sig);
        o = _order(4, 1, address(output));
        o.pool.hooks = address(1);
        vm.expectRevert(SodaLimitSettlement.InvalidPool.selector);
        settlement.execute(o, sig);
        o = _order(3, 1, address(output));
        o.amountIn = uint256(type(uint128).max) + 1;
        vm.expectRevert(SodaLimitSettlement.InvalidOrder.selector);
        settlement.execute(o, sig);
        o = _order(3, 1, address(output));
        o.inputToken = address(0);
        vm.expectRevert(SodaLimitSettlement.InvalidOrder.selector);
        settlement.execute(o, sig);
    }

    function testFalseApprovalAndNativeReentrancy() public {
        SodaLimitOrder memory o = _order(3, 1, address(output));
        _configure(o, 1000);
        input.configure(0, 0, true);
        vm.expectRevert(SodaLimitSettlement.TokenCallFailed.selector);
        settlement.execute(o, _signature(o));
        input.configure(0, 0, false);
        ReentrantReceiver r = new ReentrantReceiver(address(settlement), false);
        o = _order(4, 2, address(0));
        o.receiver = address(r);
        _configure(o, 1000);
        settlement.execute(o, _signature(o));
        assertTrue(r.attempted());
        assertTrue(r.blocked());
        assertEq(uint8(settlement.nonceStatus(address(r), 77)), 0);
    }

    function testRejectingReceiverRollbackAndDonationsPreserved() public {
        SodaLimitOrder memory o = _order(4, 1, address(0));
        o.receiver = address(new ReentrantReceiver(address(settlement), true));
        _configure(o, 1000);
        vm.expectRevert(SodaLimitSettlement.NativeTransferFailed.selector);
        settlement.execute(o, _signature(o));
        assertEq(uint8(settlement.nonceStatus(maker, 1)), 0);
        o = _order(3, 2, address(output));
        input.mint(address(settlement), 777);
        output.mint(address(settlement), 888);
        _configure(o, 1000);
        settlement.execute(o, _signature(o));
        assertEq(input.balanceOf(address(settlement)), 777);
        assertEq(output.balanceOf(address(settlement)), 888);
        assertEq(output.balanceOf(receiver), 1000);
    }

    function testFuzzFullFillAndFiniteApproval(uint128 amount, uint128 minimum) public {
        uint256 a = bound(amount, 1, 1e24);
        uint256 m = bound(minimum, 1, 1e24);
        SodaLimitOrder memory o = _order(4, 1, address(output));
        o.amountIn = a;
        o.minAmountOut = m;
        _configure(o, m);
        settlement.execute(o, _signature(o));
        assertEq(output.balanceOf(receiver), m);
        assertEq(input.balanceOf(maker), 1e30 - a);
        _assertNoApproval();
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    function targetInterfaces() external pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }

    function excludeSelectors() external pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function handlerFill(uint128 rawAmount, uint128 rawMinimum, bool v4, bool cancellation) external {
        SodaLimitOrder memory o = _order(v4 ? 4 : 3, nextNonce++, address(output));
        o.amountIn = bound(rawAmount, 1, 1e24);
        o.minAmountOut = bound(rawMinimum, 1, 1e24);
        bytes memory sig = _signature(o);
        if (cancellation) {
            vm.prank(maker);
            settlement.cancel(o.nonce);
        } else {
            _configure(o, o.minAmountOut);
            settlement.execute(o, sig);
            expectedSpent += o.amountIn;
            expectedOutput += o.minAmountOut;
        }
        vm.expectRevert(SodaLimitSettlement.NonceUnavailable.selector);
        settlement.execute(o, sig);
    }

    function invariantConservationTerminalNoncesAndNoApprovals() public {
        assertEq(input.balanceOf(maker), 1e30 - expectedSpent);
        assertEq(output.balanceOf(receiver), expectedOutput);
        assertEq(input.balanceOf(address(settlement)), 0);
        assertEq(output.balanceOf(address(settlement)), 0);
        assertEq(address(settlement).balance, 0);
        _assertNoApproval();
        for (uint256 nonce = 1; nonce < nextNonce; nonce++) {
            assertTrue(uint8(settlement.nonceStatus(maker, nonce)) != 0);
        }
    }
}

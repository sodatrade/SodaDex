// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SodaLimitOrder, PoolKey} from "./OrderTypes.sol";
import {OrderHash} from "./OrderHash.sol";
import {CanonicalRouter} from "./CanonicalRouter.sol";
import {IPermit2, IERC20, IUniversalRouter, IV3Factory, IV3Pool, IStateView} from "./Interfaces.sol";

/// @notice Non-upgradeable chain-196 test settlement. Full fill only; no custody, fees, admin or arbitrary calls.
contract SodaLimitSettlement {
    uint256 public constant CHAIN_ID = 196;
    bool public constant TEST_DEPLOYMENT = true;
    uint256 public constant PLATFORM_FEE_BPS = 0;
    address public constant ROUTER = 0xda5Bc8bc981d9b2F5df2b0c7E5aeD044993709FA;
    address public constant FACTORY = 0xa6109B7F4237d2aC28B8009FbD21B88cff194cFe;
    address public constant POOL_MANAGER = 0x6B5C32aD97EB42230138e02a21B0E6d811FD713D;
    address public constant STATE_VIEW = 0x7991D4a8493b9709365cD079DfFc75e790007874;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    enum Status {
        Open,
        Cancelled,
        Filled
    }
    mapping(address => mapping(uint256 => Status)) public nonceStatus;
    bool private entered;
    error WrongDeployment();
    error InvalidOrder();
    error InvalidPool();
    error Expired();
    error NonceUnavailable();
    error Reentrancy();
    error InputAmountMismatch();
    error OutputAmountMismatch();
    error TokenCallFailed();
    error NativeTransferFailed();
    error UnauthorizedNativeSender();
    event OrderCancelled(address indexed maker, uint256 indexed nonce);
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        uint256 indexed nonce,
        address keeper,
        address inputToken,
        address outputToken,
        uint256 amountIn,
        uint256 amountOut,
        address receiver
    );
    modifier nonReentrant() {
        if (entered) revert Reentrancy();
        entered = true;
        _;
        entered = false;
    }

    constructor() {
        if (
            block.chainid != CHAIN_ID || ROUTER.code.length == 0 || FACTORY.code.length == 0
                || POOL_MANAGER.code.length == 0 || STATE_VIEW.code.length == 0 || PERMIT2.code.length == 0
                || WOKB.code.length == 0
        ) revert WrongDeployment();
    }

    receive() external payable {
        if (msg.sender != ROUTER && msg.sender != POOL_MANAGER) revert UnauthorizedNativeSender();
    }

    function witnessTypeString() external pure returns (string memory) {
        return OrderHash.WITNESS_TYPE_STRING;
    }

    function hashOrder(SodaLimitOrder calldata order) external pure returns (bytes32) {
        return OrderHash.hash(order);
    }

    function orderDigest(SodaLimitOrder calldata order) external view returns (bytes32) {
        return
            keccak256(abi.encodePacked("\x19\x01", IPermit2(PERMIT2).DOMAIN_SEPARATOR(), OrderHash.permitHash(order)));
    }

    /// @notice Cancellation only affects this caller's orders at this settlement. It is terminal on chain.
    function cancel(uint256 nonce) external nonReentrant {
        if (nonceStatus[msg.sender][nonce] != Status.Open) revert NonceUnavailable();
        nonceStatus[msg.sender][nonce] = Status.Cancelled;
        emit OrderCancelled(msg.sender, nonce);
    }

    function validateOrder(SodaLimitOrder calldata order) external view {
        _validate(order);
    }

    function execute(SodaLimitOrder calldata order, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 received)
    {
        _validate(order);
        nonceStatus[order.maker][order.nonce] = Status.Filled;
        uint256 inputBefore = IERC20(order.inputToken).balanceOf(address(this));
        uint256 makerInputBefore = IERC20(order.inputToken).balanceOf(order.maker);
        uint256 outputBefore = _balance(order.outputToken, address(this));
        uint256 receiverBefore = _balance(order.outputToken, order.receiver);
        IPermit2(PERMIT2)
            .permitWitnessTransferFrom(
                IPermit2.PermitTransferFrom(
                    IPermit2.TokenPermissions(order.inputToken, order.amountIn), order.nonce, order.expiry
                ),
                IPermit2.SignatureTransferDetails(address(this), order.amountIn),
                order.maker,
                OrderHash.hash(order),
                OrderHash.WITNESS_TYPE_STRING,
                signature
            );
        if (IERC20(order.inputToken).balanceOf(address(this)) != inputBefore + order.amountIn) {
            revert InputAmountMismatch();
        }
        _checkMakerSpend(order, makerInputBefore);
        // The settlement is the Router payer. Maker->Router allowances never authorize this contract.
        _approve(order.inputToken, 0);
        _approve(order.inputToken, order.amountIn);
        IPermit2(PERMIT2).approve(order.inputToken, ROUTER, uint160(order.amountIn), uint48(order.expiry));
        (bytes memory commands, bytes[] memory inputs) = CanonicalRouter.build(order, address(this), WOKB);
        IUniversalRouter(ROUTER).execute(commands, inputs, order.expiry);
        IPermit2(PERMIT2).approve(order.inputToken, ROUTER, 0, 0);
        _approve(order.inputToken, 0);
        if (IERC20(order.inputToken).balanceOf(address(this)) != inputBefore) revert InputAmountMismatch();
        uint256 outputAfter = _balance(order.outputToken, address(this));
        if (outputAfter < outputBefore) revert OutputAmountMismatch();
        uint256 paid = outputAfter - outputBefore;
        if (paid < order.minAmountOut) revert OutputAmountMismatch();
        if (order.outputToken == address(0)) {
            (bool sent,) = order.receiver.call{value: paid}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            _tokenCall(order.outputToken, abi.encodeWithSelector(bytes4(0xa9059cbb), order.receiver, paid));
        }
        uint256 receiverAfter = _balance(order.outputToken, order.receiver);
        if (receiverAfter < receiverBefore) revert OutputAmountMismatch();
        received = receiverAfter - receiverBefore;
        if (received < order.minAmountOut || _balance(order.outputToken, address(this)) != outputBefore) {
            revert OutputAmountMismatch();
        }
        _checkMakerSpend(order, makerInputBefore);
        emit OrderFilled(
            OrderHash.hash(order),
            order.maker,
            order.nonce,
            msg.sender,
            order.inputToken,
            order.outputToken,
            order.amountIn,
            received,
            order.receiver
        );
    }

    function _validate(SodaLimitOrder calldata o) private view {
        if (block.chainid != CHAIN_ID || o.chainId != CHAIN_ID || o.settlement != address(this)) {
            revert WrongDeployment();
        }
        // Expiry is explicitly signed in Unix seconds; block time is the intended boundary.
        // forge-lint: disable-next-line(block-timestamp)
        if (o.expiry > type(uint48).max || block.timestamp >= o.expiry) revert Expired();
        if (nonceStatus[o.maker][o.nonce] != Status.Open) revert NonceUnavailable();
        if (
            o.maker == address(0) || o.inputToken == address(0) || o.inputToken == o.outputToken
                || o.inputToken.code.length == 0 || (o.outputToken != address(0) && o.outputToken.code.length == 0)
                || o.amountIn == 0 || o.amountIn > type(uint128).max || o.minAmountOut == 0
                || o.minAmountOut > type(uint128).max || o.receiver == address(0) || o.receiver == address(this)
                || o.receiver == ROUTER || o.receiver == PERMIT2 || o.receiver == address(1) || o.receiver == address(2)
        ) revert InvalidOrder();
        PoolKey calldata p = o.pool;
        if (
            p.currency0 >= p.currency1 || p.hooks != address(0) || p.fee >= 1_000_000 || p.tickSpacing <= 0
                || p.tickSpacing > 32767
        ) {
            revert InvalidPool();
        }
        address out = o.protocol == 3 && o.outputToken == address(0) ? WOKB : o.outputToken;
        if (!((o.inputToken == p.currency0 && out == p.currency1)
                    || (o.inputToken == p.currency1 && out == p.currency0))) {
            revert InvalidPool();
        }
        if (o.protocol == 3) {
            if (p.currency0 == address(0) || IV3Factory(FACTORY).feeAmountTickSpacing(p.fee) != p.tickSpacing) {
                revert InvalidPool();
            }
            address pool = IV3Factory(FACTORY).getPool(p.currency0, p.currency1, p.fee);
            if (pool == address(0)) revert InvalidPool();
            (uint160 price,,,,,,) = IV3Pool(pool).slot0();
            if (price == 0) revert InvalidPool();
        } else if (o.protocol == 4) {
            (uint160 price,,,) = IStateView(STATE_VIEW).getSlot0(keccak256(abi.encode(p)));
            if (price == 0) revert InvalidPool();
        } else {
            revert InvalidPool();
        }
    }

    function _checkMakerSpend(SodaLimitOrder calldata order, uint256 beforeBalance) private view {
        uint256 afterBalance = IERC20(order.inputToken).balanceOf(order.maker);
        if (afterBalance > beforeBalance || beforeBalance - afterBalance != order.amountIn) {
            revert InputAmountMismatch();
        }
    }

    function _balance(address token, address account) private view returns (uint256) {
        return token == address(0) ? account.balance : IERC20(token).balanceOf(account);
    }

    function _approve(address token, uint256 amount) private {
        _tokenCall(token, abi.encodeWithSelector(bytes4(0x095ea7b3), PERMIT2, amount));
    }

    function _tokenCall(address token, bytes memory data) private {
        (bool success, bytes memory result) = token.call(data);
        if (!success || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) {
            revert TokenCallFailed();
        }
    }
}

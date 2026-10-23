// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SodaLimitOrder, PoolKey} from "./OrderTypes.sol";

/// @notice EIP-712 encoding for a single full-fill order. No expiry or amount defaults.
library OrderHash {
    bytes32 internal constant POOL_TYPEHASH =
        keccak256("PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)");
    bytes32 internal constant ORDER_TYPEHASH = keccak256(
        "SodaLimitOrder(uint256 chainId,address settlement,address maker,address inputToken,address outputToken,uint256 amountIn,uint256 minAmountOut,address receiver,uint256 nonce,uint256 expiry,uint8 protocol,PoolKey pool)PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    string internal constant WITNESS_TYPE_STRING =
        "SodaLimitOrder witness)PoolKey(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)SodaLimitOrder(uint256 chainId,address settlement,address maker,address inputToken,address outputToken,uint256 amountIn,uint256 minAmountOut,address receiver,uint256 nonce,uint256 expiry,uint8 protocol,PoolKey pool)TokenPermissions(address token,uint256 amount)";
    bytes32 internal constant PERMIT_TYPEHASH = keccak256(
        abi.encodePacked(
            "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
            WITNESS_TYPE_STRING
        )
    );
    bytes32 internal constant TOKEN_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function poolHash(PoolKey memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(POOL_TYPEHASH, p.currency0, p.currency1, p.fee, p.tickSpacing, p.hooks));
    }

    function hash(SodaLimitOrder memory o) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                o.chainId,
                o.settlement,
                o.maker,
                o.inputToken,
                o.outputToken,
                o.amountIn,
                o.minAmountOut,
                o.receiver,
                o.nonce,
                o.expiry,
                o.protocol,
                poolHash(o.pool)
            )
        );
    }

    function permitHash(SodaLimitOrder memory o) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                keccak256(abi.encode(TOKEN_TYPEHASH, o.inputToken, o.amountIn)),
                o.settlement,
                o.nonce,
                o.expiry,
                hash(o)
            )
        );
    }
}

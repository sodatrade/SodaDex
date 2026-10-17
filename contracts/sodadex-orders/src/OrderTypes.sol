// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SodaLimitOrder {
    uint256 chainId;
    address settlement;
    address maker;
    address inputToken;
    address outputToken;
    uint256 amountIn;
    uint256 minAmountOut;
    address receiver;
    uint256 nonce;
    uint256 expiry;
    uint8 protocol;
    PoolKey pool;
}

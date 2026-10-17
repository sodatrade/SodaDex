// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SodaLimitOrder, PoolKey} from "./OrderTypes.sol";

/// @notice Only pinned Router 2.1.2 commands, one hop and hookData empty. No arbitrary calldata.
library CanonicalRouter {
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    function build(SodaLimitOrder calldata o, address recipient, address wrappedNative)
        internal
        pure
        returns (bytes memory commands, bytes[] memory inputs)
    {
        if (o.protocol == 3) {
            bool nativeOut = o.outputToken == address(0);
            inputs = new bytes[](nativeOut ? 2 : 1);
            // Pinned Router 2.1.2 requires the sixth uint256[] field. Empty means no extra hop-price limit.
            inputs[0] = abi.encode(
                nativeOut ? address(2) : recipient,
                o.amountIn,
                o.minAmountOut,
                abi.encodePacked(o.inputToken, o.pool.fee, nativeOut ? wrappedNative : o.outputToken),
                true,
                new uint256[](0)
            );
            if (nativeOut) inputs[1] = abi.encode(recipient, o.minAmountOut);
            if (nativeOut) commands = hex"000c";
            else commands = hex"00";
        } else {
            bytes[] memory actions = new bytes[](3);
            actions[0] = abi.encode(
                ExactInputSingleParams(
                    o.pool, o.inputToken == o.pool.currency0, uint128(o.amountIn), uint128(o.minAmountOut), 0, bytes("")
                )
            );
            actions[1] = abi.encode(o.inputToken, o.amountIn);
            actions[2] = abi.encode(o.outputToken, o.minAmountOut);
            inputs = new bytes[](1);
            inputs[0] = abi.encode(hex"060c0f", actions);
            commands = hex"10";
        }
    }
}

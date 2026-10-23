// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Permit2 struct/function signatures follow Uniswap/permit2 (MIT), commit cc56ad0f3439c502c246fc5cfcc3db92bb8b7219.
interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function permitWitnessTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IV3Factory {
    function getPool(address, address, uint24) external view returns (address);
    function feeAmountTickSpacing(uint24) external view returns (int24);
}

interface IV3Pool {
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool);
}

interface IStateView {
    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMiningErc20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function allowance(address, address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}
interface IActualIgnixToken is IMiningErc20 {
    function initProtection(uint64, address, address, address, address, address) external;
    function initTracker(address) external;
    function initTaxConfig(address, uint16, uint16, address, address) external;
    function setPair(address) external;
    function unlock() external;
}
interface IActualMiningFactory {
    function bindFarm(address) external;
    function newVault(address, address, address, address, bytes calldata) external returns (address);
}
interface IActualMiningTaxVault {
    struct Conversion { uint256 input; uint256 minimumFab; uint256 nonce; uint256 deadline; }
    function tracker() external view returns (address);
    function sync() external;
    function fundFarm() external;
    function protocolOwed() external view returns (uint256);
    function farmPending() external view returns (uint256);
    function conversionDigest(Conversion calldata) external view returns (bytes32);
    function convertTax(Conversion calldata, bytes calldata) external returns (uint256);
}
interface IActualMiningHolder {
    function harvest() external;
    function syncPaid() external;
    function claimFor(address) external returns (uint256);
    function claimable(address) external view returns (uint256);
    function recognisedRewards() external view returns (uint256);
    function parkedRewards() external view returns (uint256);
    function excluded(address) external view returns (bool);
    function weightOf(address) external view returns (uint256);
    function burnForBoost(uint256) external;
    function activeCredit(address) external view returns (uint256);
    function nextIncomeLot() external view returns (uint256);
}
interface IActualMiningFarm {
    struct Purchase { uint256 listingId; uint256 minerId; uint256 nativePrice; uint256 maxFab; uint256 nonce; uint256 deadline; }
    function purchaseDigest(Purchase calldata) external view returns (bytes32);
    function buyMiner(Purchase calldata, bytes calldata) external;
    function procurementBudget() external view returns (uint256);
    function procurementSpent() external view returns (uint256);
    function harvest() external;
    function recognisedRewards() external view returns (uint256);
    function receiverPaid(address) external view returns (uint256);
    function fundedLotCount(address) external view returns (uint256);
    function incomeLot(address, uint256) external view returns (uint64, uint256);
    function incomeLotThrough(address, uint256, uint256) external view returns (uint256);
}
interface IActualV2Factory { function getPair(address, address) external view returns (address); }
interface IActualV2Router {
    function addLiquidityETH(address, uint256, uint256, uint256, address, uint256) external payable returns (uint256, uint256, uint256);
    function addLiquidity(address, address, uint256, uint256, uint256, uint256, address, uint256) external returns (uint256, uint256, uint256);
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256, uint256, address[] calldata, address, uint256) external;
}

/// @dev Component test adapter only; this is not IgnixManager or a bonding curve.
contract MiningManagerIntegrationAdapter {
    address public immutable V2_ROUTER02;
    address public constant V2_LOCKER = address(0x11);
    address public constant LIQUIDITY_HELPER = address(0x12);
    address public constant POOL_MANAGER = address(0x13);
    address public constant POSITION_MANAGER = address(0x14);
    address public constant LP_LOCKER = address(0x15);
    constructor(address router) { V2_ROUTER02 = router; }
    function createProject(address factory, address token, address fab, address creator) external returns (address vault) {
        vault = IActualMiningFactory(factory).newVault(token, fab, creator, address(this), abi.encode(uint16(100), uint16(100), uint16(100), uint16(0)));
        IActualIgnixToken(token).initProtection(1 days, POOL_MANAGER, address(0x16), address(0x17), LP_LOCKER, fab);
        IActualIgnixToken(token).initTracker(IActualMiningTaxVault(vault).tracker());
        IActualIgnixToken(token).initTaxConfig(vault, 100, 100, V2_LOCKER, LIQUIDITY_HELPER);
    }
    function give(address token, address to, uint256 amount) external { require(IMiningErc20(token).transfer(to, amount)); }
    function seedProjectPool(address token, address fab) external returns (address pair) {
        require(IMiningErc20(token).approve(V2_ROUTER02, 1_000_000 ether));
        require(IMiningErc20(fab).approve(V2_ROUTER02, 100e8));
        IActualV2Router(V2_ROUTER02).addLiquidity(token, fab, 1_000_000 ether, 100e8, 0, 0, address(this), block.timestamp);
    }
    function unlock(address token, address pair) external {
        IActualIgnixToken(token).setPair(pair);
        IActualIgnixToken(token).unlock();
    }
}

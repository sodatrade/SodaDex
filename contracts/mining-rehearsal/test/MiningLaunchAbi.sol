// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMiningLaunchManager {
    struct CreateParams {
        string name; string symbol; string metadataURI; bytes32 salt; address quote;
        uint256 graduation; uint16 buyFeeBps; uint16 sellFeeBps; uint16 taxBuyBps;
        uint16 taxSellBps; uint16 snipeStartBps; uint16 snipeMins; uint256 listingFee;
        uint256 firstBuy; uint16 founderBps; uint32 founderSecs; bytes32 founderRoot;
    }
    struct TokenState {
        address creator; uint16 buyFeeBps; uint16 sellFeeBps; uint16 taxBuyBps; uint16 taxSellBps;
        address quote; uint16 snipeStartBps; uint16 snipeMins; uint64 createdAt;
        uint128 vQuote; uint128 vToken; uint128 sold; uint128 collected;
        uint128 sellable; uint128 reserve; bytes32 poolId;
    }
    function initialize(address,address,address,address,address,address,uint24,int24,address) external;
    function configure(address,address) external;
    function configure2(address,address,address,address,address) external;
    function createToken(CreateParams calldata,uint16,bytes calldata,uint64,address,uint8,uint64,bytes calldata)
        external payable returns (address);
    function buy(address,uint256,uint256) external payable;
    function sell(address,uint256,uint256) external;
    function vaultOf(address) external view returns (address);
    function pairOf(address) external view returns (address);
    function platformAccrued(address) external view returns (uint256);
    function POOL_FEE() external view returns (uint24);
    function LAUNCH_FACTORY() external view returns (address);
}

interface IMiningLaunchRegistry { function setTemplate(uint16,address) external; }
interface IMiningV2Pair {
    function balanceOf(address) external view returns (uint256);
    function token0() external view returns (address);
    function getReserves() external view returns (uint112,uint112,uint32);
}
interface IMiningV2Locker {
    function baselineOf(address) external view returns (uint256);
    function harvest(address) external returns (uint256);
    function accrued(address,address) external view returns (uint256);
    function platformAccrued(address) external view returns (uint256);
    function claim(address) external;
    function claimPlatform(address) external;
}
interface IMiningLiquidityHelper {
    function addLiquidity(address,uint256,uint256,uint256,uint256,uint256) external returns (uint256,uint256,uint256);
    function removeLiquidity(address,uint256,uint256,uint256,uint256) external returns (uint256,uint256);
}

contract MiningCreate2Deployer {
    function deploy(bytes32 salt, bytes memory initcode) external returns (address deployed) {
        assembly { deployed := create2(0, add(initcode,32), mload(initcode),salt) }
        require(deployed.code.length != 0, "CREATE2 failed");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev ABI of the pinned FABX miner, including the separate 1952 actual-payout extension.
interface IFabxMining {
    struct Miner {
        address circuits;
        uint64 circuitId;
        uint32 taskId;
        uint32 gateCount;
        uint32 stateCount;
        uint32 depth;
        uint64 area;
        uint32 mult;
        uint64 since;
        uint8 status;
        address registrant;
        uint32 nandBurn;
        uint32 latchBurn;
        uint64 bstar;
        uint64 bonus;
        bool optimal;
        uint64 commitBlock;
        uint64 firstUnusedId;
        uint64 stopBlock;
        uint128 verifWeight;
        uint128 unverWeight;
        uint256 debt;
        uint32 boostBps;
    }

    function token() external view returns (address);
    function paused() external view returns (bool);
    function getMiner(bytes32 key) external view returns (Miner memory);
    function claim(bytes32 key) external;
    function paidTo(bytes32 key, address recipient) external view returns (uint256);
    function processorMultiplier(address collection) external view returns (uint256);
    function dewebWeights(bytes32 key) external view returns (uint256, uint256, uint256, uint256);
}

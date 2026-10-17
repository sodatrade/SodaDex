// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OkbBoostBase} from "fabx/test/OkbBoost.t.sol";

/// @dev Pinned Merkle vectors and real NAND execution; no miner storage overrides.
abstract contract FabxChallengeFixture is OkbBoostBase {
    function _vectors() private view returns (string memory) {
        return vm.readFile(string.concat(vm.envString("SODADEX_FABX_FIXTURES"), "/vectors-240.json"));
    }

    function _tapeVector(address who, bool incorrect) internal returns (uint256 id) {
        string memory designs = vm.readFile(string.concat(vm.envString("SODADEX_FABX_FIXTURES"), "/designs.json"));
        bytes memory netlist = vm.parseJsonBytes(designs, incorrect ? ".nand8WrongOnVector.netlist" : ".nand8.netlist");
        vm.startPrank(who);
        transistors.mint(0, incorrect ? 65 : 8);
        id = circuits.tapeout{value: circuits.TAPEOUT_FEE()}(netlist, 16, 8);
        vm.stopPrank();
    }

    function _vectorSamples(uint256 id, uint256 anchor, uint32 gates, bool avoid)
        private view returns (bytes[] memory ins, bytes[] memory outs, bytes32[][] memory proofs, bool suitable)
    {
        uint32 count = pod.sampleCountFor(gates, 1);
        ins = new bytes[](count); outs = new bytes[](count); proofs = new bytes32[][](count);
        string memory vectors = _vectors();
        for (uint32 k; k < count; ++k) {
            uint256 index = uint256(keccak256(abi.encodePacked(blockhash(anchor), address(circuits), id, k))) % 256;
            if (avoid && index == 7) return (ins, outs, proofs, false);
            string memory suffix = string.concat("[", vm.toString(index), "]");
            ins[k] = vm.parseJsonBytes(vectors, string.concat(".inputs", suffix));
            outs[k] = vm.parseJsonBytes(vectors, string.concat(".outs", suffix));
            proofs[k] = vm.parseJsonBytes32Array(vectors, string.concat(".proofs", suffix));
        }
        suitable = true;
    }

    function _addVectorTask() internal returns (uint32 taskId) {
        uint256 referenceId = _tapeVector(owner, false);
        uint256 anchor = _anchor();
        (bytes[] memory ins,bytes[] memory outs,bytes32[][] memory proofs,) = _vectorSamples(referenceId, anchor, 8, false);
        vm.prank(owner);
        taskId = pod.addTask("NAND8 actual challenge", 0, 1, 16, 8, 256,
            0x8fa8ab36018f5bb7d93fa5b6c84bd1967bf2c5f5d8ca828f74c993a27df30007,
            address(circuits), referenceId, anchor, ins, outs, proofs);
        _startVectorMiner(owner, referenceId, taskId, false);
    }

    function _startVectorMiner(address who, uint256 id, uint32 taskId, bool incorrect) internal returns (bytes32) {
        for (uint256 attempt; attempt < 20; ++attempt) {
            vm.prank(who);
            pod.arm(address(circuits), id);
            uint256 anchor = _anchor();
            (bytes[] memory ins,bytes[] memory outs,bytes32[][] memory proofs,bool suitable) =
                _vectorSamples(id, anchor, incorrect ? 65 : 8, incorrect);
            if (!suitable) continue;
            vm.prank(who);
            return pod.start(address(circuits), id, taskId, anchor, ins, outs, proofs, 0);
        }
        revert("Could not avoid the known bad vector in20 real sampling attempts");
    }

    function _challengeVector(uint256 id) internal {
        bytes32[] memory proof = vm.parseJsonBytes32Array(_vectors(), ".proofs[7]");
        bytes32 key = pod.minerKey(address(circuits), id);
        vm.prank(keeper);
        pod.challenge(key, 7, hex"82d5", hex"7f", proof);
    }
}

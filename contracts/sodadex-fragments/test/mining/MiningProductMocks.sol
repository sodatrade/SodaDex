// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IFabxMining } from "../../src/mining/interfaces/IFabxMining.sol";

/// @dev Unit fixtures only. Real FABX source is tested separately in SodaDEX rehearsal.
contract MockMiningFab is ERC20 {
    constructor() ERC20("Unit FAB", "UNIT-FAB") { }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockMiningFactory {
    mapping(address => bool) public isCPU;

    function register(address collection) external {
        isCPU[collection] = true;
    }
}

contract MockMiningNft is ERC721 {
    address public immutable factory;

    constructor(address f) ERC721("Unit miner", "UNIT-NFT") {
        factory = f;
    }

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract MockFabxMining is IFabxMining {
    address public immutable token;
    MockMiningNft public immutable nft;
    bool public paused;
    mapping(bytes32 => Miner) private _miners;
    mapping(bytes32 => uint256) public pending;
    mapping(bytes32 => mapping(address => uint256)) public paidTo;

    struct InstantReceipt {
        uint64 at;
        uint256 amount;
    }
    mapping(bytes32 => mapping(address => InstantReceipt[])) private _receipts;

    constructor(MockMiningFab fab, MockMiningNft collection) {
        token = address(fab);
        nft = collection;
    }

    function processorMultiplier(address) external pure returns (uint256) {
        return 6;
    }

    function rewardHistoryVersion() external pure returns (uint256) {
        return 2;
    }

    function rewardReceiptCount(bytes32 key, address recipient) external view returns (uint256) {
        return _receipts[key][recipient].length;
    }

    /// @dev Unit pending rewards are instantaneous, unlike the separate real-source tests.
    function rewardPaidThrough(
        bytes32 key,
        address recipient,
        uint256 first,
        uint256 last,
        uint256 at
    ) external view returns (uint256 amount) {
        for (uint256 i = first; i < last; ++i) {
            InstantReceipt storage r = _receipts[key][recipient][i];
            if (r.at <= at) amount += r.amount;
        }
    }

    function keyOf(uint256 id) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(nft), id));
    }

    function getMiner(bytes32 key) external view returns (Miner memory) {
        return _miners[key];
    }

    function dewebWeights(bytes32 key) external view returns (uint256, uint256, uint256, uint256) {
        Miner storage m = _miners[key];
        return (m.verifWeight, m.unverWeight, m.verifWeight, m.unverWeight);
    }

    function admit(uint256 id, uint64 baseWeight) external {
        Miner storage m = _miners[keyOf(id)];
        m.circuits = address(nft);
        m.circuitId = uint64(id);
        m.taskId = 1;
        m.mult = 6;
        m.status = 1;
        m.bstar = baseWeight / 6;
        m.verifWeight = uint128(uint256(baseWeight) * 100);
        m.boostBps = 10_000;
    }

    function setPending(uint256 id, uint256 amount) external {
        pending[keyOf(id)] += amount;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function resetPaidCounter(uint256 id, address recipient) external {
        paidTo[keyOf(id)][recipient] = 0;
    }

    function disqualify(uint256 id) external {
        claim(keyOf(id));
        Miner storage m = _miners[keyOf(id)];
        m.status = 2;
        m.verifWeight = 0;
    }

    function setPremium(uint256 id) external {
        Miner storage m = _miners[keyOf(id)];
        m.optimal = true;
        m.bonus = 1;
        m.verifWeight += 600;
    }

    function claim(bytes32 key) public {
        require(!paused, "source paused");
        require(_miners[key].status == 1, "inactive");
        uint256 amount = pending[key];
        pending[key] = 0;
        address recipient = nft.ownerOf(_miners[key].circuitId);
        paidTo[key][recipient] += amount;
        if (amount != 0) {
            _receipts[key][recipient].push(InstantReceipt(uint64(block.timestamp), amount));
        }
        MockMiningFab(token).mint(recipient, amount);
    }
}

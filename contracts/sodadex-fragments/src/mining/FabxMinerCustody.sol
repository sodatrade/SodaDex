// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IFabxMining } from "./interfaces/IFabxMining.sol";

interface IFabxCollection {
    function factory() external view returns (address);
}

interface IFabxFactory {
    function isCPU(address collection) external view returns (bool);
}

/// @dev Shared custody and reward-source accounting, not a standalone product vault.
abstract contract FabxMinerCustody is IERC721Receiver {
    IERC20 public immutable MINING_ASSET;
    IFabxMining public immutable MINING;
    IERC721 public immutable MINER_NFT;
    address public immutable NFT_FACTORY;
    uint256 public immutable PROCESSOR_MULTIPLIER;
    uint16 public immutable MAX_MINERS;

    uint256[] private _minerIds;
    mapping(uint256 => uint256) private _indexPlusOne;
    mapping(uint256 => uint256) private _paidBaseline;
    bool private _receiving;
    uint256 private _expectedId;
    address private _expectedFrom;
    address private _expectedOperator;

    event MinerAdmitted(uint256 indexed id, uint256 weight);
    event MinerReleased(uint256 indexed id);
    event MiningCollected(uint256 amount, uint256 eligibleWeight);

    error InvalidMiningBinding();
    error IneligibleMiner();
    error UnexpectedNft();
    error MiningUnavailable();
    error InvalidPaidCounter();
    error MinerCapacityReached();

    constructor(
        IERC20 asset,
        IFabxMining mining,
        IERC721 collection,
        address factory,
        uint16 capacity
    ) {
        if (
            capacity == 0 || address(asset).code.length == 0 || address(mining).code.length == 0
                || address(collection).code.length == 0 || factory.code.length == 0
                || mining.token() != address(asset)
                || IFabxCollection(address(collection)).factory() != factory
                || !IFabxFactory(factory).isCPU(address(collection))
        ) revert InvalidMiningBinding();
        uint256 multiplier = mining.processorMultiplier(address(collection));
        if (multiplier == 0) revert InvalidMiningBinding();
        // Old FABX implementations without the actual-paid extension cannot be used.
        mining.paidTo(bytes32(0), address(this));
        MINING_ASSET = asset;
        MINING = mining;
        MINER_NFT = collection;
        NFT_FACTORY = factory;
        PROCESSOR_MULTIPLIER = multiplier;
        MAX_MINERS = capacity;
    }

    function minerCount() public view returns (uint256) {
        return _minerIds.length;
    }

    function minerAt(uint256 index) external view returns (uint256) {
        return _minerIds[index];
    }

    function containsMiner(uint256 id) public view returns (bool) {
        return _indexPlusOne[id] != 0;
    }

    function minerKey(uint256 id) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(MINER_NFT), id));
    }

    /// @notice Weight in unscaled base-hashrate points, not the protocol's x100 unit.
    function eligibleWeight(uint256 id) public view returns (uint256) {
        IFabxMining.Miner memory m = MINING.getMiner(minerKey(id));
        uint256 weight = uint256(m.bstar) * m.mult;
        if (
            m.circuits != address(MINER_NFT) || m.circuitId != id || m.status != 1 || m.taskId == 0
                || m.mult != PROCESSOR_MULTIPLIER || m.unverWeight != 0 || m.verifWeight == 0
        ) return 0;
        return weight;
    }

    /// @dev New admissions exclude premiums and boosts. Promotion after custody
    /// does not destroy an existing NFT's underlying base-weight backing.
    function admissibleMiner(uint256 id) public view returns (bool) {
        uint256 weight = eligibleWeight(id);
        IFabxMining.Miner memory m = MINING.getMiner(minerKey(id));
        if (
            weight == 0 || m.optimal || m.bonus != 0 || m.boostBps != 10_000
                || m.verifWeight != weight * 100
        ) return false;
        (uint256 verified, uint256 unverified,,) = MINING.dewebWeights(minerKey(id));
        return verified == m.verifWeight && unverified == 0;
    }

    function totalEligibleWeight() public view returns (uint256 total) {
        for (uint256 i; i < _minerIds.length; ++i) {
            total += eligibleWeight(_minerIds[i]);
        }
    }

    /// @dev A product must collect and allocate under OLD ownership before changing shares.
    /// Historical stored dividend claims must not call this function or depend on source liveness.
    function _collectMining() internal returns (uint256 received, uint256 weight) {
        if (_minerIds.length != 0 && MINING.paused()) revert MiningUnavailable();
        for (uint256 i; i < _minerIds.length; ++i) {
            uint256 id = _minerIds[i];
            bytes32 key = minerKey(id);
            if (MINER_NFT.ownerOf(id) != address(this)) revert UnexpectedNft();
            if (MINING.getMiner(key).status == 1) MINING.claim(key);
            uint256 cumulative = MINING.paidTo(key, address(this));
            if (cumulative < _paidBaseline[id]) revert InvalidPaidCounter();
            received += cumulative - _paidBaseline[id];
            _paidBaseline[id] = cumulative;
            weight += eligibleWeight(id);
        }
        emit MiningCollected(received, weight);
    }

    function _depositMiner(address from, uint256 id) internal returns (uint256 weight) {
        if (_minerIds.length >= MAX_MINERS) revert MinerCapacityReached();
        if (containsMiner(id) || MINER_NFT.ownerOf(id) != from) revert UnexpectedNft();
        // Settle the NFT's old-owner rewards before taking custody.
        MINING.claim(minerKey(id));
        if (!admissibleMiner(id)) revert IneligibleMiner();
        _expectNft(from, address(this), id);
        MINER_NFT.safeTransferFrom(from, address(this), id);
        _receiving = false;
        // Reweigh for the new owner, then apply the admission rules again.
        MINING.claim(minerKey(id));
        return _admitOwnedMiner(id);
    }

    function _expectNft(address from, address operator, uint256 id) internal {
        if (_receiving) revert UnexpectedNft();
        _receiving = true;
        _expectedId = id;
        _expectedFrom = from;
        _expectedOperator = operator;
    }

    function _admitOwnedMiner(uint256 id) internal returns (uint256 weight) {
        _receiving = false;
        if (_minerIds.length >= MAX_MINERS) revert MinerCapacityReached();
        if (containsMiner(id) || MINER_NFT.ownerOf(id) != address(this)) revert UnexpectedNft();
        weight = eligibleWeight(id);
        if (weight == 0 || !admissibleMiner(id)) revert IneligibleMiner();
        _paidBaseline[id] = MINING.paidTo(minerKey(id), address(this));
        _minerIds.push(id);
        _indexPlusOne[id] = _minerIds.length;
        emit MinerAdmitted(id, weight);
    }

    function _releaseMiner(uint256 id, address to) internal {
        uint256 index = _indexPlusOne[id];
        if (index == 0 || eligibleWeight(id) == 0) revert IneligibleMiner();
        uint256 last = _minerIds[_minerIds.length - 1];
        _minerIds[index - 1] = last;
        _indexPlusOne[last] = index;
        _minerIds.pop();
        delete _indexPlusOne[id];
        MINER_NFT.safeTransferFrom(address(this), to, id);
        emit MinerReleased(id);
    }

    function onERC721Received(address operator, address from, uint256 id, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (
            msg.sender != address(MINER_NFT) || !_receiving || id != _expectedId
                || from != _expectedFrom || operator != _expectedOperator
        ) revert UnexpectedNft();
        return IERC721Receiver.onERC721Received.selector;
    }
}

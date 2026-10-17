// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployTapeOut} from "fabx/script/DeployTapeOut.s.sol";
import {Script} from "forge-std/Script.sol";
import {CircuitFactory} from "fabx/src/CircuitFactory.sol";
import {Circuits} from "fabx/src/Circuits.sol";
import {Transistors} from "fabx/src/Transistors.sol";
import {PodMining} from "fabx/src/pod/PodMining.sol";
import {PodToken} from "fabx/src/pod/PodToken.sol";
import {PodLens} from "fabx/src/pod/PodLens.sol";
import {CircuitMarket} from "fabx/src/market/CircuitMarket.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Test dependency composition only, not either mining product. The companion command
///      runs without --broadcast or a keystore. Returned addresses are proposed, not deployed.
contract PrepareFabx1952 is Script {
    address public constant TEST_OWNER = 0x6ecf746b078d46391f8C425B150153212F7C0545;

    error WrongTestChain();
    error WrongTestOwner();

    function run() external returns (DeployTapeOut.Deployed memory d, address marketProxy, address lens) {
        if (block.chainid != 1952) revert WrongTestChain();
        if (msg.sender != TEST_OWNER) revert WrongTestOwner();
        vm.startBroadcast(TEST_OWNER);
        // Test setup fees only. Product trading/service fees are configured separately.
        d = _deploy();
        (d.firstTransistors, d.firstCircuits) = CircuitFactory(d.factory)
            .createCPU("SodaDEX TEST FAB Miner", "TEST-FAB-NFT", "X Layer 1952 learning/test assets", 100_000, 0);
        Circuits(d.firstCircuits).setTapeoutFee(0);
        PodMining(d.podMining).setProcessor(d.firstCircuits, 6);
        CircuitMarket market = new CircuitMarket();
        marketProxy = address(
            new ERC1967Proxy(
                address(market), abi.encodeCall(CircuitMarket.initialize, (TEST_OWNER, d.factory, TEST_OWNER, 0))
            )
        );
        lens = address(new PodLens(d.podMining));
        vm.stopBroadcast();

        require(PodMining(d.podMining).owner() == TEST_OWNER, "mining owner");
        require(PodMining(d.podMining).token() == d.xmake, "mining FAB");
        require(PodToken(d.xmake).minter() == d.podMining, "FAB minter");
        require(PodToken(d.xmake).decimals() == 8, "FAB precision");
        require(CircuitFactory(d.factory).owner() == TEST_OWNER, "factory owner");
        require(CircuitFactory(d.factory).deployFee() == 0, "test CPU fee");
        require(CircuitFactory(d.factory).protocolFee() == 0, "test mint protocol fee");
        require(CircuitFactory(d.factory).isCPU(d.firstCircuits), "registered CPU");
        require(Circuits(d.firstCircuits).factory() == d.factory, "CPU factory");
        require(Circuits(d.firstCircuits).transistors() == d.firstTransistors, "CPU transistors");
        require(Transistors(d.firstTransistors).circuits() == d.firstCircuits, "transistors CPU");
        require(Transistors(d.firstTransistors).mintPrice() == 0, "test mint price");
        require(Transistors(d.firstTransistors).protocolFee() == 0, "test mint fee");
        require(Circuits(d.firstCircuits).TAPEOUT_FEE() == 0, "test tapeout fee");
        require(PodMining(d.podMining).processorMultiplier(d.firstCircuits) == 6, "CPU weight");
        require(CircuitMarket(marketProxy).owner() == TEST_OWNER, "market owner");
        require(CircuitMarket(marketProxy).factory() == d.factory, "market factory");
        require(CircuitMarket(marketProxy).feeBps() == 0, "test market fee");
        require(address(PodLens(lens).mining()) == d.podMining, "lens mining");
    }

    /// @dev Same dependency sequence as pinned DeployTapeOut.deploy, with test-only owners
    ///      and fees. Do not inherit its unrestricted, environment-selected run() entry point.
    function _deploy() private returns (DeployTapeOut.Deployed memory d) {
        d.transistorsImpl = address(new Transistors());
        d.circuitsImpl = address(new Circuits(TEST_OWNER));
        d.factoryImpl = address(new CircuitFactory());
        d.factory = address(
            new ERC1967Proxy(
                d.factoryImpl,
                abi.encodeCall(
                    CircuitFactory.initialize, (TEST_OWNER, d.transistorsImpl, d.circuitsImpl, TEST_OWNER, 0, 0)
                )
            )
        );
        d.podMiningImpl = address(new PodMining());
        address predicted = vm.computeCreateAddress(TEST_OWNER, vm.getNonce(TEST_OWNER) + 1);
        d.xmake = address(new PodToken("SodaDEX TEST FAB", "TEST-FAB", predicted, TEST_OWNER));
        d.podMining = address(
            new ERC1967Proxy(d.podMiningImpl, abi.encodeCall(PodMining.initialize, (TEST_OWNER, d.xmake, uint64(0))))
        );
        require(d.podMining == predicted, "mining nonce prediction");
    }
}

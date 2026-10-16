// SPDX-License-Identifier: GPL-2.0-or-later
// SodaDEX modification 2026-10-16: original SodaDEX artwork; upstream attribution retained.
pragma solidity >=0.7.6;
import '@openzeppelin/contracts/utils/Strings.sol';
import './SodaSVG.sol';
/// @notice SodaDEX test-position SVG adapter.
/// @dev Derived interface from https://github.com/Uniswap/v3-periphery/blob/697c2474757ea89fec12a4e6db16a574fe259610/contracts/libraries/NFTSVG.sol
library NFTSVG {
    using Strings for uint256;
    struct SVGParams { string quote; string base; string feeTier; string lower; string upper; uint256 tokenId; }
    function generateSVG(SVGParams memory p) internal pure returns (string memory) {
        /*
        address: "0xe8ab59d3bcde16a29912de83a90eb39628cfc163",
        msg: "Forged in SVG for Uniswap in 2021 by 0xe8ab59d3bcde16a29912de83a90eb39628cfc163",
        sig: "0x2df0e99d9cbfec33a705d83f75666d98b22dea7c1af412c584f7d626d83f02875993df740dc87563b9c73378f8462426da572d7989de88079a382ad96c57b68d1b",
        version: "2"
        */
        return SodaSVG.render(SodaSVG.Card(p.quote, p.base, p.feeTier, p.lower, p.upper, p.tokenId.toString(), "V3"));
    }
}

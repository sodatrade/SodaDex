// SPDX-License-Identifier: MIT
// SodaDEX modification 2026-10-16: original SodaDEX artwork; upstream attribution retained.
pragma solidity ^0.8.0;
import 'openzeppelin-contracts/contracts/utils/Strings.sol';
import './SodaSVG.sol';
/// @notice SodaDEX test-position SVG adapter.
/// @dev Derived interface from https://github.com/Uniswap/v4-periphery/blob/545a5d2a87228167edde48f3b9eda122d1e3c4d6/src/libraries/SVG.sol
library SVG {
    using Strings for uint256;
    struct SVGParams { string quote; string base; string feeTier; string lower; string upper; uint256 tokenId; }
    function generateSVG(SVGParams memory p) internal pure returns (string memory) {
        return SodaSVG.render(SodaSVG.Card(p.quote, p.base, p.feeTier, p.lower, p.upper, p.tokenId.toString(), "V4"));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9.0;
import './SodaMetadata.sol';

/// @notice Original SodaDEX test-position artwork, created 2026-10-16.
library SodaSVG {
    struct Card { string quote; string base; string fee; string lower; string upper; string tokenId; string protocol; }
    function render(Card memory card) internal pure returns (string memory) {
        bytes memory top = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640" viewBox="0 0 480 640" role="img">',
            '<title>SodaDEX test liquidity position</title><defs><clipPath id="text"><rect x="32" y="130" width="416" height="138"/></clipPath></defs>',
            '<rect width="480" height="640" rx="32" fill="#171b18"/><rect x="1" y="1" width="478" height="638" rx="31" fill="none" stroke="#3a4439"/>',
            '<path d="M310 0H480V230L362 112Z" fill="#232e21"/><circle cx="404" cy="69" r="28" fill="#b5f84d"/>',
            '<path d="M390 69h28m-14-14v28" stroke="#171b18" stroke-width="3"/>',
            '<g font-family="Arial,Helvetica,sans-serif"><text x="32" y="65" fill="#b5f84d" font-size="32" font-weight="700">SodaDEX</text>',
            '<text x="32" y="101" fill="#b7c5b2" font-size="12" letter-spacing="3">TEST DEPLOYMENT / ', card.protocol, '</text>',
            '<g clip-path="url(#text)" fill="#f7faf3" font-size="32" font-weight="700"><text x="32" y="173">', SodaMetadata.xml(card.quote),
            '</text><text x="32" y="220">/ ', SodaMetadata.xml(card.base), '</text></g>',
            '<rect x="32" y="255" width="416" height="178" rx="20" fill="#222a20"/><path d="M56 405H423M56 285V405" stroke="#46533f"/>',
            '<path d="M59 392C146 392 139 347 229 347S317 299 421 290" fill="none" stroke="#b5f84d" stroke-width="4"/>',
            '<circle cx="229" cy="347" r="7" fill="#b5f84d"/>');
        bytes memory bottom = abi.encodePacked(
            '<text x="32" y="473" fill="#8fa087" font-size="11" letter-spacing="2">PRICE RANGE</text>',
            '<text x="32" y="504" fill="#f7faf3" font-size="20">', SodaMetadata.xml(card.lower), ' / ', SodaMetadata.xml(card.upper), '</text>',
            '<path d="M32 535H448" stroke="#3a4439"/><text x="32" y="565" fill="#8fa087" font-size="11">LP FEE</text>',
            '<text x="32" y="595" fill="#b5f84d" font-size="21">', SodaMetadata.xml(card.fee), '</text>',
            '<text x="448" y="565" text-anchor="end" fill="#8fa087" font-size="11">POSITION</text>',
            '<text x="448" y="595" text-anchor="end" fill="#f7faf3" font-size="21">#', card.tokenId, '</text></g></svg>');
        return string(abi.encodePacked(top, bottom));
    }
}

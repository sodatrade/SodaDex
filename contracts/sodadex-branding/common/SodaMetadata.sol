// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9.0;

/// @notice SodaDEX metadata text encoding, created 2026-10-16.
/// @dev Escape into one bounded buffer; never concatenate user text as markup.
library SodaMetadata {
    function json(string memory text) internal pure returns (string memory) { return encode(text, false); }
    function xml(string memory text) internal pure returns (string memory) { return encode(text, true); }

    function encode(string memory text, bool markup) private pure returns (string memory) {
        bytes memory src = bytes(text);
        bytes memory out = new bytes(src.length * 8);
        bytes memory hexDigits = "0123456789abcdef";
        uint256 cursor;
        for (uint256 i; i < src.length; i++) {
            uint8 c = uint8(src[i]);
            bytes memory replacement;
            if (markup && c == 38) replacement = bytes("&amp;");
            else if (markup && c == 60) replacement = bytes("&lt;");
            else if (markup && c == 62) replacement = bytes("&gt;");
            else if (markup && c == 34) replacement = bytes("&quot;");
            else if (markup && c == 39) replacement = bytes("&apos;");
            else if (!markup && c == 34) replacement = bytes('\\"');
            else if (!markup && c == 92) replacement = bytes("\\\\");
            else if (c < 32) {
                if (markup && (c == 9 || c == 10 || c == 13)) out[cursor++] = src[i];
                else if (markup) replacement = bytes("&#xfffd;");
                else replacement = abi.encodePacked("\\u00", hexDigits[c >> 4], hexDigits[c & 15]);
            } else if (c >= 128) {
                uint256 size = utf8Size(src, i);
                // XML 1.0 excludes these two BMP noncharacters even though
                // they are valid Unicode/UTF-8 and remain valid in JSON.
                if (markup && size == 3 && c == 239 && uint8(src[i+1]) == 191 && uint8(src[i+2]) >= 190) {
                    replacement = bytes("&#xfffd;");
                    i += 2;
                } else if (size == 0) replacement = bytes(markup ? "&#xfffd;" : "\\ufffd");
                else {
                    for (uint256 j; j < size; j++) out[cursor++] = src[i + j];
                    i += size - 1;
                }
            } else out[cursor++] = src[i];
            for (uint256 j; j < replacement.length; j++) out[cursor++] = replacement[j];
        }
        assembly { mstore(out, cursor) }
        return string(out);
    }

    function utf8Size(bytes memory s, uint256 i) private pure returns (uint256) {
        uint8 a = uint8(s[i]);
        uint256 size = a >= 194 && a <= 223 ? 2 : a >= 224 && a <= 239 ? 3 : a >= 240 && a <= 244 ? 4 : 0;
        if (size == 0 || i + size > s.length) return 0;
        for (uint256 j = 1; j < size; j++) if (uint8(s[i+j]) < 128 || uint8(s[i+j]) > 191) return 0;
        uint8 b = uint8(s[i+1]);
        if ((a == 224 && b < 160) || (a == 237 && b > 159) || (a == 240 && b < 144) || (a == 244 && b > 143)) return 0;
        return size;
    }
}

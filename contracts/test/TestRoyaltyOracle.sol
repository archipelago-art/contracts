// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../IRoyaltyOracle.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract TestRoyaltyOracle is IRoyaltyOracle {
    function royalties(
        IERC721 token,
        uint256 tokenId,
        uint32 micros,
        uint64 data
    ) external pure returns (RoyaltyResult[] memory) {
        RoyaltyResult[] memory results;

        if (data == 0) {
            // default: send full royalty to the burn address
            results = new RoyaltyResult[](1);
            results[0] = RoyaltyResult({micros: micros, recipient: address(1)});
        } else if (data == 1) {
            // pay two royalties: one to token id (as address), one to token contract
            // Lets us verify that the info pipes through correctly.
            results = new RoyaltyResult[](2);
            results[0] = RoyaltyResult({
                micros: micros / 2,
                recipient: address(uint160(tokenId))
            });
            results[1] = RoyaltyResult({
                micros: micros / 2,
                recipient: address(token)
            });
        } else if (data == 2) {
            // error mode: try to pay excess micros (assuming micros > 0)
            results = new RoyaltyResult[](2);
            results[0] = RoyaltyResult({micros: micros, recipient: address(1)});
            results[1] = RoyaltyResult({micros: micros, recipient: address(2)});
        }

        // if data > 2, return empty array.
        return results;
    }
}

// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestERC721 is ERC721 {
    constructor() ERC721("Test ERC721", "T721") {}

    function mint(address _recipient, uint256 _tokenId) public {
        _safeMint(_recipient, _tokenId);
    }
}

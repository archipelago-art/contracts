// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor() ERC20("Test ERC20", "T20") {}

    function mint(address _recipient, uint256 _amount) public {
        _mint(_recipient, _amount);
    }
}

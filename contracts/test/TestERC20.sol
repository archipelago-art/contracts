// SPDX-License-Identifier: GPL-2.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    bool paused;

    constructor() ERC20("Test ERC20", "T20") {}

    function setPaused(bool _paused) public {
        paused = _paused;
    }

    function mint(address _account, uint256 _amount) public {
        _mint(_account, _amount);
    }

    function transfer(address _recipient, uint256 _amount)
        public
        virtual
        override
        returns (bool)
    {
        if (paused) return false;
        return ERC20.transfer(_recipient, _amount);
    }

    function transferFrom(
        address _sender,
        address _recipient,
        uint256 _amount
    ) public virtual override returns (bool) {
        if (paused) return false;
        return ERC20.transferFrom(_sender, _recipient, _amount);
    }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

contract Clock {
    function timestamp() public view returns (uint256) {
        return block.timestamp;
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Popcnt.sol";

contract PopcntFixture {
    function popcnt(uint256 _x) external pure returns (uint256) {
        return Popcnt.popcnt(_x);
    }

    function popcntMany(uint256[] memory _xs)
        external
        pure
        returns (uint256[] memory)
    {
        uint256[] memory _result = new uint256[](_xs.length);
        for (uint256 _i = 0; _i < _xs.length; _i++) {
            _result[_i] = Popcnt.popcnt(_xs[_i]);
        }
        return _result;
    }
}

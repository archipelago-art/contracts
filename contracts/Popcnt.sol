// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

library Popcnt {
    /// Computes the population count of `_x`: i.e., the number of bits that
    /// are set. Also known as the Hamming weight.
    ///
    /// Implementation is the standard contraction algorithm.
    function popcnt(uint256 _x) internal pure returns (uint256) {
        _x = (_x & MASK_0) + ((_x >> 1) & MASK_0);
        _x = (_x & MASK_1) + ((_x >> 2) & MASK_1);
        _x = (_x & MASK_2) + ((_x >> 4) & MASK_2);
        _x = (_x & MASK_3) + ((_x >> 8) & MASK_3);
        _x = (_x & MASK_4) + ((_x >> 16) & MASK_4);
        _x = (_x & MASK_5) + ((_x >> 32) & MASK_5);
        _x = (_x & MASK_6) + ((_x >> 64) & MASK_6);
        _x = (_x & MASK_7) + ((_x >> 128) & MASK_7);
        return _x;
    }

    /// To compute these constants:
    ///
    /// ```python3
    /// for i in range(8):
    ///     pow = 2 ** i
    ///     bits = ("0" * pow + "1" * pow) * (256 // (2 * pow))
    ///     num = int(bits, 2)
    ///     hexstr = "0x" + hex(num)[2:].zfill(64)
    ///     print("uint256 constant MASK_%s = %s;" % (i, hexstr))
    /// ```
    uint256 constant MASK_0 =
        0x5555555555555555555555555555555555555555555555555555555555555555;
    uint256 constant MASK_1 =
        0x3333333333333333333333333333333333333333333333333333333333333333;
    uint256 constant MASK_2 =
        0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f;
    uint256 constant MASK_3 =
        0x00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff;
    uint256 constant MASK_4 =
        0x0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff;
    uint256 constant MASK_5 =
        0x00000000ffffffff00000000ffffffff00000000ffffffff00000000ffffffff;
    uint256 constant MASK_6 =
        0x0000000000000000ffffffffffffffff0000000000000000ffffffffffffffff;
    uint256 constant MASK_7 =
        0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff;
}

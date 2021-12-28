// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./ITraitOracle.sol";

contract CircuitOracle is ITraitOracle {
    uint256 internal constant OP_STOP = 0x00;
    uint256 internal constant OP_NOT = 0x01;
    uint256 internal constant OP_OR = 0x02;
    uint256 internal constant OP_AND = 0x03;

    string internal constant ERR_OVERRUN_STATIC =
        "CircuitOracle: static buffer overrun";
    string internal constant ERR_OVERRUN_CONSTANT =
        "CircuitOracle: constant buffer overrun";
    string internal constant ERR_OVERRUN_ARG =
        "CircuitOracle: arg buffer overrun";

    function hasTrait(
        IERC721 _tokenContract,
        uint256 _tokenId,
        bytes memory _buf
    ) external view override returns (bool) {
        // Note: `_buf` is *uniquely owned* and will be destructively consumed
        // as it is read.
        //
        // ABI reminders:
        //
        //    - EVM memory is a word-addressed byte array. `mload(_a)` reads
        //      the bytes at `_a + 0`, ..., `_a + 31` and assembles them into a
        //      32-byte word (big-endian).
        //
        //    - `_buf` points to 32 consecutive bytes that indicate the length
        //      of the buffer. That is, `mload(_buf)` gives `_buf.length`.
        //
        //    - The data of `_buf` is stored inline in the subsequent bytes.
        //      That is, `mload(add(_buf, add(32, _i)))` gives a word whose low
        //      byte is `_buf[_i]`.
        //
        // So, if `_buf.length` is initially `_n`, and `_k <= _n`:
        //
        //    - To truncate `_buf` to length `_k`, so that it becomes a prefix
        //      of its old value, simply store the 32-byte word `_k` into
        //      `_buf`. This leaves the rest of the data dangling off the end
        //      of `_buf`, which is fine.
        //
        //    - To remove the first `_k` bytes of `_buf`, so that it becomes a
        //      suffix of its old value, first add `_k` to `_buf`, and then
        //      store the 32-byte word `_n - _k` into the new value of `_buf`.
        //      This is *destructive* in that it overwrites up to 32 bytes of
        //      memory that were previously part of `_buf`'s data. This is fine
        //      as long as there are no other references to that data.

        if (_buf.length < 96) revert(ERR_OVERRUN_STATIC);
        uint256 _dynamicLength = _buf.length - 96;
        assembly {
            // SAFETY: We've just checked that `_buf.length` is at least 96, so
            // this is only truncating it.
            mstore(_buf, 96)
        }
        (ITraitOracle _delegate, uint256 _remainingLengths, uint256 _ops) = abi
            .decode(_buf, (ITraitOracle, uint256, uint256));
        assembly {
            // SAFETY: Before truncation, `_buf` had length at least 96, and
            // `_dynamicLength` is the remaining length, so this consumes a
            // prefix of length 96.
            _buf := add(_buf, 96)
            mstore(_buf, _dynamicLength)
        }

        uint256 _mem = 0; // `_mem & (1 << _i)` stores variable `_i`
        uint256 _v = 0; // next variable to assign

        // Read and initialize constant variables.
        while (true) {
            uint256 _traitLength = _remainingLengths & 0xffff;
            if (_traitLength == 0) break;
            _traitLength--;
            _remainingLengths >>= 16;

            if (_buf.length < _traitLength) revert(ERR_OVERRUN_CONSTANT);
            uint256 _newBufLength = _buf.length - _traitLength;

            // Temporarily truncate `_buf` to `_traitLength` for external call.
            assembly {
                // SAFETY: We've just checked that `_buf.length` is at least
                // `_traitLength`, so this is only truncating it.
                mstore(_buf, _traitLength)
            }
            bool _hasTrait = _delegate.hasTrait(_tokenContract, _tokenId, _buf);
            _mem |= uint256(_hasTrait ? 1 : 0) << _v++;

            // Then, un-truncate `_buf` and advance it past this trait.
            assembly {
                // SAFETY: Before truncation, `_buf` had length at least
                // `_traitLength`, and `_newBufLength` is the remaining length,
                // so this consumes a prefix of length `_traitLength`.
                _buf := add(_buf, _traitLength)
                mstore(_buf, _newBufLength)
            }
        }

        // Evaluate operations. Henceforth, `_buf` represents the full array of
        // arguments. (It's no longer strictly necessary to destructively
        // consume from `_buf`, so we return to normal array accesses.)
        uint256 _nextArg = 0;
        while (true) {
            uint256 _op = _ops & 0x03;
            _ops >>= 2;
            if (_op == OP_STOP) break;
            bool _output;
            if (_op == OP_NOT) {
                if (_buf.length < _nextArg + 1) revert(ERR_OVERRUN_ARG);
                bool _a = (_mem & (1 << uint256(uint8(_buf[_nextArg++])))) != 0;
                _output = !_a;
            } else {
                if (_buf.length < _nextArg + 2) revert(ERR_OVERRUN_ARG);
                bool _a = (_mem & (1 << uint256(uint8(_buf[_nextArg++])))) != 0;
                bool _b = (_mem & (1 << uint256(uint8(_buf[_nextArg++])))) != 0;
                _output = _op == OP_OR ? _a || _b : _a && _b;
            }
            _mem |= uint256(_output ? 1 : 0) << _v++;
        }

        if (_v == 0) return false; // no constants or ops
        return (_mem & (1 << (_v - 1))) != 0;
    }
}

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
    string internal constant ERR_OVERRUN_BASE_TRAIT =
        "CircuitOracle: base trait buffer overrun";
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
        // SAFETY: We've just checked that `_buf.length` is at least 96, so
        // this can't underflow.
        uint256 _dynamicLength = uncheckedSub(_buf.length, 96);
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
        // INVARIANT: `_v` is always less than `type(uint256).max`, because
        // it's only changed by incrementing it by 1 at a time once per loop
        // iteration (in each `while` loop). Each loop is bounded: the first
        // runs at most 16 times, as it consumes 16 bits of `_remainingLengths`
        // _remainingLengths` at a time and stops once it becomes zero; and the
        // second runs at most 128 times, as it consumes 2 bits of `_ops` at a
        // time and stops once it becomes zero.
        uint256 _v = 0; // next variable to assign

        // Read and initialize base trait variables.
        while (true) {
            uint256 _traitLength = _remainingLengths & 0xffff;
            _remainingLengths >>= 16;
            if (_traitLength == 0) break;
            // SAFETY: We've just checked that `_traitLength != 0`, so this
            // can't underflow.
            _traitLength = uncheckedSub(_traitLength, 1);

            if (_buf.length < _traitLength) revert(ERR_OVERRUN_BASE_TRAIT);
            // SAFETY: We've just checked that `_buf.length` is at least
            // `_traitLength`, so this can't underflow.
            uint256 _newBufLength = uncheckedSub(_buf.length, _traitLength);

            // Temporarily truncate `_buf` to `_traitLength` for external call.
            assembly {
                // SAFETY: We've just checked that `_buf.length` is at least
                // `_traitLength`, so this is only truncating it.
                mstore(_buf, _traitLength)
            }
            bool _hasTrait = _delegate.hasTrait(_tokenContract, _tokenId, _buf);
            uint256 _hasTraitInt;
            assembly {
                // SAFETY: Simple bool-to-int cast.
                _hasTraitInt := _hasTrait
            }
            // SAFETY: `_v` is small (see declaration comment), so incrementing
            // it can't overflow.
            _mem |= _hasTraitInt << _v;
            _v = uncheckedAdd(_v, 1);

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
        //
        // INVARIANT: `_nextArg` is always less than `type(uint256).max - 1`.
        // It's only changed by incrementing it by 1 or 2 per loop iteration,
        // and the loop runs at most 128 times (it terminates if `_ops == 0`,
        // and it shifts `_ops` right by 2 bits each iteration).
        uint256 _nextArg = 0;
        while (true) {
            uint256 _op = _ops & 0x03;
            _ops >>= 2;
            if (_op == OP_STOP) break;
            bool _output;
            if (_op == OP_NOT) {
                // SAFETY: `_nextArg` is small (see declaration comment), so
                // adding 1 to it can't overflow.
                if (_buf.length < uncheckedAdd(_nextArg, 1))
                    revert(ERR_OVERRUN_ARG);
                bool _a = (_mem & (1 << uint256(uint8(_buf[_nextArg])))) != 0;
                // SAFETY: `_nextArg` is small (see declaration comment), so
                // adding 1 to it can't overflow.
                _nextArg = uncheckedAdd(_nextArg, 1);
                _output = !_a;
            } else {
                // SAFETY: `_nextArg` is small (see declaration comment),
                // so this addition can't overflow.
                if (_buf.length < uncheckedAdd(_nextArg, 2))
                    revert(ERR_OVERRUN_ARG);
                bool _a = (_mem & (1 << uint256(uint8(_buf[_nextArg])))) != 0;
                // SAFETY: `_nextArg` is small (see declaration comment), so
                // adding 1 to it can't overflow.
                bool _b = (_mem &
                    (1 << uint256(uint8(_buf[uncheckedAdd(_nextArg, 1)])))) !=
                    0;
                // SAFETY: `_nextArg` is small (see declaration comment),
                // so this can't overflow.
                _nextArg = uncheckedAdd(_nextArg, 2);
                _output = _op == OP_OR ? _a || _b : _a && _b;
            }
            uint256 _outputInt;
            assembly {
                // SAFETY: Simple bool-to-int cast.
                _outputInt := _output
            }
            _mem |= _outputInt << _v;
            // SAFETY: `_v` is small (see declaration comment), so incrementing
            // it can't overflow.
            _v = uncheckedAdd(_v, 1);
        }

        if (_v == 0) return false; // no base traits or ops
        // SAFETY: We've just checked that `_v != 0`, so this subtraction
        // can't underflow.
        return (_mem & (1 << uncheckedSub(_v, 1))) != 0;
    }

    /// Returns `_a + _b` without checking for or signalling overflow.
    ///
    /// # Safety
    ///
    /// Caller must ensure that `_a + _b` would not overflow or be prepared to
    /// handle an overflowed result.
    function uncheckedAdd(uint256 _a, uint256 _b)
        internal
        pure
        returns (uint256)
    {
        unchecked {
            return _a + _b;
        }
    }

    /// Returns `_a - _b` without checking for or signalling underflow.
    ///
    /// # Safety
    ///
    /// Caller must ensure that `_a - _b` would not underflow or be prepared to
    /// handle an underflowed result.
    function uncheckedSub(uint256 _a, uint256 _b)
        internal
        pure
        returns (uint256)
    {
        unchecked {
            return _a - _b;
        }
    }
}

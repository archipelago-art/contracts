// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./ITraitOracle.sol";

contract CircuitOracle is ITraitOracle {
    uint256 internal constant OP_STOP = 0x00;
    uint256 internal constant OP_NOT = 0x01;
    uint256 internal constant OP_OR = 0x02;
    uint256 internal constant OP_AND = 0x03;

    string internal constant ERR_OVERRUN_BASE_TRAIT =
        "CircuitOracle: base trait buffer overrun";
    string internal constant ERR_OVERRUN_ARG =
        "CircuitOracle: arg buffer overrun";

    /// Checks if the given token satisfies the circuit specified by `_buf`.
    ///
    /// `_buf` should be at least 96 bytes long, with the following format:
    ///
    ///   - Bytes 0 through 31 specify the address of an underlying trait
    ///     oracle (zero-padded per Solidity ABI conventions).
    ///   - Bytes 32 through 63 specify a `uint256` that encodes the lengths of
    ///     between 0 and 16 (inclusive) base traits, each 16 bits long.
    ///   - Bytes 64 through 95 specify between 0 and 128 (inclusive) circuit
    ///     opcodes, each 2 bits long.
    ///   - The remaining bytes are the concatenated contents of the base
    ///     traits followed by the concatenated arguments to the circuit ops.
    ///
    /// Details of base trait lengths: The length of each base trait is
    /// incremented by one to form a `uint16`, and the `_i`th such value is
    /// stored in  `(_encodedLengths >> (16 * _i)) & 0xffff`. There are no more
    /// base traits once this evaluates to `0` (because `0` is not `_len + 1`
    /// for any `_len`).
    ///
    /// Details of opcodes: Each opcode is a 2-bit value: STOP is 0, NOT is 1,
    /// OR is 2, AND is 3. Opcode `_i` is stored in `(_ops >> (2 * _i)) & 0x03`.
    /// Once this evaluates to 0, circuit evaluation stops and returns the most
    /// recently computed value, or `false` if there were no base traits and no
    /// ops other than STOP.
    ///
    /// Details of evaluation: There is a bank of up to 256 boolean variables,
    /// all initially false. First, the base traits (if any) are read from
    /// `_buf`. The underlying trait oracle is invoked for each, and the result
    /// for the `_i`th trait is stored into variable `_i`. Next, the ops are
    /// processed sequentially. A STOP op immediately stops evaluation. A NOT,
    /// OR, or AND op consumes either 1 or 2 argument indices, reads the
    /// argument variable(s), applies the operation. Each argument index is
    /// a single byte from `_buf` and corresponds to one of the 256 boolean
    /// variables. Once the op is evaluated, it is written into the next free
    /// variable. Thus, if there were `_n` base traits, the `_i`th op's result
    /// is stored into variable `_n + _i`.
    ///
    /// When evaluation stops, the result is the most recently written
    /// variable, or `false` if no variables were written. That is: the result
    /// is the result of the last op, or the last base trait if there were no
    /// ops, or `false` if there were no ops and no base traits.
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
        //      This operation is performed by `unsafeSetLength`.
        //
        //    - To remove the first `_k` bytes of `_buf`, so that it becomes a
        //      suffix of its old value, first add `_k` to `_buf`, and then
        //      store the 32-byte word `_n - _k` into the new value of `_buf`.
        //      This is *destructive* in that it overwrites up to 32 bytes of
        //      memory that were previously part of `_buf`'s data. This is fine
        //      as long as there are no other references to that data.
        //
        //      This operation is performed by `unsafeConsume`.

        // Decode the static part of the header (the first 96 bytes), then
        // advance to the dynamic part.
        (ITraitOracle _delegate, uint256 _remainingLengths, uint256 _ops) = abi
            .decode(_buf, (ITraitOracle, uint256, uint256));
        // SAFETY: The ABI decoding operation would have reverted if
        // `_buf.length < 96`, so the subtraction can't underflow. Then,
        // `_buf[96 : 96 + (_buf.length - 96)]` represents a proper suffix of
        // `_buf`, so the region is still entirely owned by `_buf`.
        _buf = unsafeConsume(_buf, 96, uncheckedSub(_buf.length, 96));

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
            // `_traitLength` is zero if we're out of traits, else it's one
            // more than the length of the next trait.
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
            //
            // SAFETY: We've just checked that `_buf.length` is at least
            // `_traitLength`, so this is only truncating it.
            unsafeSetLength(_buf, _traitLength);
            bool _hasTrait = _delegate.hasTrait(_tokenContract, _tokenId, _buf);
            // Then, un-truncate `_buf` and advance it past this trait.
            //
            // SAFETY: `_newBufLength + _traitLength` equals the value of
            // `_buf.length` before `_buf` was truncated, so this region is still
            // entirely owned by `_buf`.
            _buf = unsafeConsume(_buf, _traitLength, _newBufLength);

            // SAFETY: `_v` is small (see declaration comment), so incrementing
            // it can't overflow.
            _mem |= boolToUint256(_hasTrait) << _v;
            _v = uncheckedAdd(_v, 1);
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
                uint256 _arg0 = _nextArg;
                // SAFETY: `_nextArg` is small (see declaration comment), so
                // this addition can't overflow.
                _nextArg = uncheckedAdd(_nextArg, 1);

                if (_buf.length < _nextArg) revert(ERR_OVERRUN_ARG);
                bool _v0 = (_mem & (1 << uint256(uint8(_buf[_arg0])))) != 0;
                _output = !_v0;
            } else {
                uint256 _arg0 = _nextArg;
                // SAFETY: `_nextArg` is small (see declaration comment), so
                // these additions can't overflow.
                uint256 _arg1 = uncheckedAdd(_arg0, 1);
                _nextArg = uncheckedAdd(_arg0, 2);

                if (_buf.length < _nextArg) revert(ERR_OVERRUN_ARG);
                bool _v0 = (_mem & (1 << uint256(uint8(_buf[_arg0])))) != 0;
                bool _v1 = (_mem & (1 << uint256(uint8(_buf[_arg1])))) != 0;
                _output = _op == OP_OR ? _v0 || _v1 : _v0 && _v1;
            }
            _mem |= boolToUint256(_output) << _v;
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

    /// Equivalent to `uint256(_b ? 1 : 0)`, but without the `jump`/`jumpi`
    /// sequence that solc generates for that input.
    function boolToUint256(bool _b) internal pure returns (uint256 _x) {
        assembly {
            _x := _b
        }
    }

    /// Forces the length of `_b` to `_length` without any checks.
    ///
    /// # Safety
    ///
    /// Caller must ensure that bytes `0` to `_length` (exclusive) of `_b` are
    /// exclusively owned by `_b`.
    function unsafeSetLength(bytes memory _b, uint256 _length) internal pure {
        assembly {
            mstore(_b, _length)
        }
    }

    /// Destructively advance `_b` by `_offset`, setting its length to
    /// `_newLength` and returning the new base pointer. The caller should
    /// store the result of this function back into `_b`:
    ///
    ///     _b = unsafeConsume(_b, _offset, _newLength);
    ///
    /// This overwrites (up to) 32 bytes of memory previously pointed to by
    /// `_b` to store the new length value, so `_b` should be exclusively owned
    /// by the caller.
    ///
    /// # Safety
    ///
    /// Caller must ensure that bytes `_offset` to `_offset + _newLength`
    /// (exclusive, where the "+" is not modulo 2^256) of `_b` are exclusively
    /// owned by `_b`.
    function unsafeConsume(
        bytes memory _b,
        uint256 _offset,
        uint256 _newLength
    ) internal pure returns (bytes memory) {
        assembly {
            _b := add(_b, _offset)
            mstore(_b, _newLength)
        }
        return _b;
    }
}

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import {
    byteLengthForType,
    classifyRead,
    decodeRead,
    decodeValue,
    formatAddress,
    normalizeAddress
} from '../../diagnostics/rc2-memory.js';

test('preserves RPCS3 addresses above 32 bits exactly', () => {
    const address = 0x301329A90n;

    assert.equal(normalizeAddress(address), address);
    assert.equal(normalizeAddress('0x301329a90'), address);
    assert.equal(normalizeAddress('12904995472'), address);
    assert.equal(normalizeAddress(0x301329A90), address);
    assert.equal(formatAddress(address), '0x0000000301329a90');
});

test('accepts the unsigned 64-bit limit and rejects invalid or unsafe addresses', () => {
    assert.equal(normalizeAddress('0xffffffffffffffff'), 0xFFFFFFFFFFFFFFFFn);
    assert.equal(normalizeAddress('  0X301329A90  '), 0x301329A90n);
    assert.equal(normalizeAddress(' 12904995472 '), 0x301329A90n);
    assert.equal(formatAddress(0n), '0x0000000000000000');
    assert.equal(formatAddress(0xFFFFFFFFFFFFFFFFn), '0xffffffffffffffff');
    assert.throws(() => normalizeAddress(-1), RangeError);
    assert.throws(() => normalizeAddress('0x10000000000000000'), RangeError);
    assert.throws(() => normalizeAddress(9007199254740992), /safe integers/);
    assert.throws(() => normalizeAddress('0xnot-an-address'), /unsigned decimal or hexadecimal/);
    assert.throws(() => normalizeAddress(''), /unsigned decimal or hexadecimal/);
    assert.throws(() => normalizeAddress(null), /BigInt, safe integer, or integer string/);
});

test('decodes unsigned values in explicit byte order', () => {
    const bytes = Uint8Array.from([0x01, 0x23, 0x45, 0x67]);

    assert.equal(decodeValue(bytes, 'uint32', 'big'), 0x01234567);
    assert.equal(decodeValue(bytes, 'uint32', 'little'), 0x67452301);
});

test('decodes signed integers, 64-bit integers, and floats', () => {
    assert.equal(decodeValue(Uint8Array.from([0xff, 0xff, 0xff, 0xfe]), 'int32', 'big'), -2);
    assert.equal(
        decodeValue(Uint8Array.from([0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10]), 'uint64', 'big'),
        0xFEDCBA9876543210n
    );
    assert.equal(decodeValue(Uint8Array.from([0x3f, 0x80, 0x00, 0x00]), 'float32', 'big'), 1);
});

test('decodes signed and unsigned widths in both byte orders', () => {
    const cases = [
        { type: 'int8', bytes: [0xfe], big: -2, little: -2 },
        { type: 'uint8', bytes: [0xfe], big: 254, little: 254 },
        { type: 'int16', bytes: [0xff, 0xfe], big: -2, little: -257 },
        { type: 'uint16', bytes: [0x12, 0x34], big: 0x1234, little: 0x3412 },
        { type: 'int32', bytes: [0xff, 0xff, 0xff, 0xfe], big: -2, little: -16777217 },
        { type: 'uint32', bytes: [0x12, 0x34, 0x56, 0x78], big: 0x12345678, little: 0x78563412 },
        {
            type: 'int64',
            bytes: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe],
            big: -2n,
            little: -72057594037927937n
        },
        {
            type: 'uint64',
            bytes: [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef],
            big: 0x0123456789ABCDEFn,
            little: 0xEFCDAB8967452301n
        }
    ];

    for (const item of cases) {
        const bytes = Uint8Array.from(item.bytes);
        assert.equal(decodeValue(bytes, item.type, 'big'), item.big, `${item.type} big-endian`);
        assert.equal(decodeValue(bytes, item.type, 'little'), item.little, `${item.type} little-endian`);
    }
});

test('decodes views with a non-zero byte offset and little-endian floats', () => {
    const backing = Uint8Array.from([0xaa, 0x00, 0x00, 0x80, 0x3f, 0xbb]);
    const floatBytes = backing.subarray(1, 5);
    const bufferView = Buffer.from([0xaa, 0x78, 0x56, 0x34, 0x12, 0xbb]).subarray(1, 5);

    assert.equal(decodeValue(floatBytes, 'float32', 'little'), 1);
    assert.equal(decodeValue(bufferView, 'uint32', 'little'), 0x12345678);
});

test('classifies a complete successful zero read and preserves it as a value', () => {
    const read = {
        success: true,
        bytes: Uint8Array.from([0, 0, 0, 0]),
        bytesRead: 4,
        requestedBytes: 4
    };

    assert.equal(classifyRead(read).status, 'complete');
    assert.deepEqual(decodeRead(read, 'uint32', 'big'), {
        status: 'complete', requestedBytes: 4, bytesRead: 4, value: 0
    });
});

test('does not decode failed or partial reads, including a failed read with bytes returned', () => {
    const failed = decodeRead({
        success: false,
        bytes: Uint8Array.from([0, 0, 0, 0]),
        bytesRead: 0,
        requestedBytes: 4,
        errorCode: 299
    }, 'uint32', 'big');
    const partial = decodeRead({
        success: false,
        bytes: Uint8Array.from([0, 0, 0, 0]),
        bytesRead: 2,
        requestedBytes: 4,
        errorCode: 299
    }, 'uint32', 'big');

    assert.deepEqual(failed, {
        status: 'failed', requestedBytes: 4, bytesRead: 0, errorCode: 299
    });
    assert.deepEqual(partial, {
        status: 'partial', requestedBytes: 4, bytesRead: 2, errorCode: 299
    });
    assert.equal(Object.hasOwn(failed, 'value'), false);
    assert.equal(Object.hasOwn(partial, 'value'), false);
});

test('does not decode when the reported byte count is full but the buffer is short', () => {
    const result = decodeRead({
        success: true,
        bytes: Uint8Array.from([0x12, 0x34]),
        bytesRead: 4,
        requestedBytes: 4
    }, 'uint32', 'big');

    assert.deepEqual(result, { status: 'partial', requestedBytes: 4, bytesRead: 4 });
    assert.equal(Object.hasOwn(result, 'value'), false);
});

test('classifies zero-byte success as partial and a failed full-count read as failed', () => {
    assert.deepEqual(classifyRead({
        success: true,
        bytes: Uint8Array.of(0, 0),
        bytesRead: 0,
        requestedBytes: 2
    }), { status: 'partial', requestedBytes: 2, bytesRead: 0 });
    assert.deepEqual(classifyRead({
        success: false,
        bytes: Uint8Array.of(0, 0),
        bytesRead: 2,
        requestedBytes: 2,
        errorCode: 299
    }), { status: 'failed', requestedBytes: 2, bytesRead: 2, errorCode: 299 });
});

test('validates read metadata and decoder inputs', () => {
    assert.equal(byteLengthForType('uint64'), 8);
    assert.throws(() => byteLengthForType('pointer'), /unsupported data type/);
    assert.throws(() => decodeValue(Uint8Array.of(1, 2), 'uint32', 'big'), /requires exactly 4 bytes/);
    assert.throws(() => decodeValue(Uint8Array.of(1), 'uint8', 'native'), /byteOrder/);
    assert.throws(() => classifyRead({ success: true, bytesRead: 1, requestedBytes: 0 }), /requestedBytes/);
    assert.throws(() => classifyRead({ success: true, bytesRead: 2, requestedBytes: 1 }), /bytesRead/);
    assert.throws(() => classifyRead({ success: true, bytes: [], bytesRead: 0, requestedBytes: 1 }), /Uint8Array/);
    assert.throws(() => classifyRead({ bytesRead: 0, requestedBytes: 1 }), /success/);
    assert.throws(() => classifyRead({ success: true, bytesRead: 0.5, requestedBytes: 1 }), /bytesRead/);
    assert.throws(() => classifyRead({
        success: false, bytesRead: 0, requestedBytes: 1, errorCode: -1
    }), /errorCode/);
    assert.throws(() => classifyRead({
        success: false, bytesRead: 0, requestedBytes: 1, errorCode: 1.5
    }), /errorCode/);
});

test('requires a read length matching the selected data type before decoding', () => {
    assert.throws(() => decodeRead({
        success: true,
        bytes: Uint8Array.of(0, 0),
        bytesRead: 2,
        requestedBytes: 2
    }, 'uint32', 'big'), /reads require 4 bytes/);
    assert.throws(() => decodeRead({
        success: true,
        bytes: Uint8Array.of(0),
        bytesRead: 1,
        requestedBytes: 1
    }, 'uint8', 'native'), /byteOrder/);
    assert.throws(() => decodeRead({
        success: true,
        bytes: Uint8Array.of(0),
        bytesRead: 1,
        requestedBytes: 1
    }, 'pointer', 'big'), /unsupported data type/);
});

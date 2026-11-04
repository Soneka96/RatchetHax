const MAX_ADDRESS = 0xFFFFFFFFFFFFFFFFn;

const TYPES = Object.freeze({
    int8: { bytes: 1, getter: 'getInt8' },
    uint8: { bytes: 1, getter: 'getUint8' },
    int16: { bytes: 2, getter: 'getInt16' },
    uint16: { bytes: 2, getter: 'getUint16' },
    int32: { bytes: 4, getter: 'getInt32' },
    uint32: { bytes: 4, getter: 'getUint32' },
    int64: { bytes: 8, getter: 'getBigInt64' },
    uint64: { bytes: 8, getter: 'getBigUint64' },
    float32: { bytes: 4, getter: 'getFloat32' },
    float64: { bytes: 8, getter: 'getFloat64' }
});

function assertByteView(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new TypeError('bytes must be a Uint8Array or Buffer');
    }
}

export function normalizeAddress(address) {
    let value;

    if (typeof address === 'bigint') {
        value = address;
    } else if (typeof address === 'number') {
        if (!Number.isSafeInteger(address)) {
            throw new TypeError('numeric addresses must be safe integers; use BigInt or a string');
        }
        value = BigInt(address);
    } else if (typeof address === 'string') {
        const text = address.trim();
        if (/^0x[0-9a-f]+$/i.test(text)) value = BigInt(text);
        else if (/^\d+$/.test(text)) value = BigInt(text);
        else throw new TypeError('address must be an unsigned decimal or hexadecimal integer');
    } else {
        throw new TypeError('address must be a BigInt, safe integer, or integer string');
    }

    if (value < 0n || value > MAX_ADDRESS) {
        throw new RangeError('address must fit in an unsigned 64-bit integer');
    }

    return value;
}

export function formatAddress(address) {
    return `0x${normalizeAddress(address).toString(16).padStart(16, '0')}`;
}

export function byteLengthForType(type) {
    const definition = TYPES[type];
    if (!definition) throw new TypeError(`unsupported data type: ${type}`);
    return definition.bytes;
}

export function decodeValue(bytes, type, byteOrder) {
    assertByteView(bytes);
    const definition = TYPES[type];
    if (!definition) throw new TypeError(`unsupported data type: ${type}`);
    if (byteOrder !== 'big' && byteOrder !== 'little') {
        throw new TypeError('byteOrder must be "big" or "little"');
    }
    if (bytes.byteLength !== definition.bytes) {
        throw new RangeError(`${type} requires exactly ${definition.bytes} bytes`);
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const getter = view[definition.getter].bind(view);
    return definition.bytes === 1 ? getter(0) : getter(0, byteOrder === 'little');
}

export function decodeRead(read, type, byteOrder) {
    const expectedBytes = byteLengthForType(type);
    const { status, requestedBytes, bytesRead, errorCode } = classifyRead(read);
    const result = { status, requestedBytes, bytesRead };
    if (errorCode !== undefined) result.errorCode = errorCode;

    if (status !== 'complete') return result;
    if (requestedBytes !== expectedBytes) {
        throw new RangeError(`${type} reads require ${expectedBytes} bytes, received request for ${requestedBytes}`);
    }

    result.value = decodeValue(read.bytes.subarray(0, requestedBytes), type, byteOrder);
    return result;
}

export function classifyRead(read) {
    if (!read || typeof read !== 'object') throw new TypeError('read result must be an object');
    const { success, bytes, bytesRead, requestedBytes, errorCode } = read;

    if (typeof success !== 'boolean') throw new TypeError('success must be a boolean');
    if (!(Number.isSafeInteger(requestedBytes) && requestedBytes > 0)) {
        throw new RangeError('requestedBytes must be a positive safe integer');
    }
    if (!(Number.isSafeInteger(bytesRead) && bytesRead >= 0 && bytesRead <= requestedBytes)) {
        throw new RangeError('bytesRead must be between zero and requestedBytes');
    }
    if (bytes !== undefined) assertByteView(bytes);
    if (errorCode !== undefined && !(Number.isSafeInteger(errorCode) && errorCode >= 0)) {
        throw new RangeError('errorCode must be a non-negative safe integer');
    }

    const availableBytes = bytes?.byteLength ?? 0;
    let status = 'complete';
    if (bytesRead > 0 && bytesRead < requestedBytes) {
        status = 'partial';
    } else if (!success) {
        status = 'failed';
    } else if (bytesRead !== requestedBytes || availableBytes < requestedBytes) {
        status = 'partial';
    }

    const result = { status, requestedBytes, bytesRead };
    if (errorCode !== undefined) result.errorCode = errorCode;
    return result;
}

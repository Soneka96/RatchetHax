import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatAddress, normalizeAddress } from './rc2-memory.js';

const UINT32_MAX = 0xFFFFFFFF;
const UINT32_GUEST_SPACE = 0x100000000n;

function asBuffer(value, name) {
    if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Buffer or Uint8Array`);
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function parseUInt32(value, name) {
    let parsed;
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        parsed = value;
    } else if (typeof value === 'bigint') {
        if (value < 0n || value > BigInt(UINT32_MAX)) throw new RangeError(`${name} must fit in an unsigned 32-bit integer`);
        parsed = Number(value);
    } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        parsed = Number(value.trim());
    } else {
        throw new TypeError(`${name} must be an unsigned decimal integer`);
    }

    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > UINT32_MAX) {
        throw new RangeError(`${name} must fit in an unsigned 32-bit integer`);
    }
    return parsed;
}

export function scanBigEndianTransition({
    beforeBytes,
    afterBytes,
    guestBase,
    guestStart,
    beforeValue,
    afterValue,
    alignment = 4
}) {
    const before = asBuffer(beforeBytes, 'beforeBytes');
    const after = asBuffer(afterBytes, 'afterBytes');
    if (before.byteLength === 0) throw new RangeError('snapshots must not be empty');
    if (before.byteLength !== after.byteLength) throw new RangeError('snapshot lengths must match');
    if (!(Number.isSafeInteger(alignment) && alignment >= 4 && alignment % 4 === 0)) {
        throw new RangeError('alignment must be a positive multiple of 4');
    }

    const base = normalizeAddress(guestBase);
    const start = normalizeAddress(guestStart);
    if ((start % BigInt(alignment)) !== 0n) throw new RangeError('guestStart must satisfy the requested alignment');
    const length = BigInt(before.byteLength);
    if (start + length > UINT32_GUEST_SPACE) throw new RangeError('snapshot range exceeds the 32-bit PS3 guest address space');
    const lastHostAddress = base + start + length - 1n;
    normalizeAddress(lastHostAddress);

    const oldValue = parseUInt32(beforeValue, 'beforeValue');
    const newValue = parseUInt32(afterValue, 'afterValue');
    if (oldValue === newValue) throw new RangeError('beforeValue and afterValue must differ');

    const candidates = [];
    for (let offset = 0; offset <= before.byteLength - 4; offset += alignment) {
        if (before.readUInt32BE(offset) !== oldValue || after.readUInt32BE(offset) !== newValue) continue;

        const candidateGuestAddress = start + BigInt(offset);
        candidates.push({
            offsetBytes: offset,
            guestAddress: formatAddress(candidateGuestAddress),
            hostAddress: formatAddress(base + candidateGuestAddress),
            beforeValue: oldValue,
            afterValue: newValue,
            dataType: 'uint32',
            byteOrder: 'big',
            verification: 'candidate; exact value transition found in these two snapshots'
        });
    }

    return {
        schemaVersion: 1,
        status: 'scan_complete',
        guestBase: formatAddress(base),
        guestStart: formatAddress(start),
        snapshotBytes: before.byteLength,
        beforeHudBolts: oldValue,
        afterHudBolts: newValue,
        byteOrder: 'big',
        dataType: 'uint32',
        alignment,
        candidateCount: candidates.length,
        candidates
    };
}

function readOptionalMetadata(snapshotPath, readFile = readFileSync, pathExists = existsSync) {
    const metadataPath = `${snapshotPath}.meta.json`;
    if (!pathExists(metadataPath)) return null;
    const metadata = JSON.parse(readFile(metadataPath, 'utf8'));
    if (metadata.status !== 'snapshot_complete' || metadata.kind !== 'raw-guest-memory-range') {
        throw new Error(`Snapshot metadata is not complete: ${metadataPath}`);
    }
    return metadata;
}

function validateMetadataOverride(key, override, metadataValue, comparison = 'address') {
    if (override === undefined || metadataValue === undefined || metadataValue === null) return;
    const matches = comparison === 'value'
        ? parseUInt32(override, key) === parseUInt32(metadataValue, `metadata ${key}`)
        : normalizeAddress(override) === normalizeAddress(metadataValue);
    if (!matches) throw new Error(`${key} override conflicts with snapshot metadata.`);
}

export function scanSnapshotFiles({
    beforePath,
    afterPath,
    guestBase,
    guestStart,
    beforeValue,
    afterValue,
    alignment = 4,
    readFile = readFileSync,
    pathExists = existsSync
}) {
    if (!beforePath || !afterPath) throw new Error('Both --before and --after snapshot paths are required.');
    const beforeMetadata = readOptionalMetadata(beforePath, readFile, pathExists);
    const afterMetadata = readOptionalMetadata(afterPath, readFile, pathExists);

    const metadataSources = [beforeMetadata, afterMetadata].filter(Boolean);
    for (const metadata of metadataSources) {
        if (metadata.snapshotFile && path.resolve(metadata.snapshotFile) !== path.resolve(metadata === beforeMetadata ? beforePath : afterPath)) {
            throw new Error('Snapshot metadata path does not match its binary file.');
        }
    }
    if (beforeMetadata && afterMetadata) {
        for (const key of ['guestBase', 'guestStart', 'lengthBytes']) {
            if (String(beforeMetadata[key]).toLowerCase() !== String(afterMetadata[key]).toLowerCase()) {
                throw new Error(`Snapshot metadata differs for ${key}.`);
            }
        }
    }

    validateMetadataOverride('guestBase', guestBase, beforeMetadata?.guestBase);
    validateMetadataOverride('guestBase', guestBase, afterMetadata?.guestBase);
    validateMetadataOverride('guestStart', guestStart, beforeMetadata?.guestStart);
    validateMetadataOverride('guestStart', guestStart, afterMetadata?.guestStart);
    validateMetadataOverride('beforeValue', beforeValue, beforeMetadata?.visibleBolts, 'value');
    validateMetadataOverride('afterValue', afterValue, afterMetadata?.visibleBolts, 'value');

    const beforeBytes = readFile(beforePath);
    const afterBytes = readFile(afterPath);
    const beforeLength = beforeMetadata?.lengthBytes;
    const afterLength = afterMetadata?.lengthBytes;
    if (beforeLength !== undefined && beforeLength !== beforeBytes.byteLength) throw new Error('Before snapshot length does not match its metadata.');
    if (afterLength !== undefined && afterLength !== afterBytes.byteLength) throw new Error('After snapshot length does not match its metadata.');

    const resolvedGuestBase = guestBase ?? beforeMetadata?.guestBase ?? afterMetadata?.guestBase;
    const resolvedGuestStart = guestStart ?? beforeMetadata?.guestStart ?? afterMetadata?.guestStart;
    const resolvedBeforeValue = beforeValue ?? beforeMetadata?.visibleBolts;
    const resolvedAfterValue = afterValue ?? afterMetadata?.visibleBolts;
    if (resolvedGuestBase === undefined || resolvedGuestStart === undefined) {
        throw new Error('Guest base and guest start are required either as options or snapshot metadata.');
    }
    if (resolvedBeforeValue === undefined || resolvedAfterValue === undefined || resolvedBeforeValue === null || resolvedAfterValue === null) {
        throw new Error('Visible bolt counts are required either as options or snapshot metadata.');
    }

    return scanBigEndianTransition({
        beforeBytes,
        afterBytes,
        guestBase: resolvedGuestBase,
        guestStart: resolvedGuestStart,
        beforeValue: resolvedBeforeValue,
        afterValue: resolvedAfterValue,
        alignment
    });
}

export function parseDiffArguments(args) {
    const parsed = {};
    const valueOptions = new Map([
        ['--before', 'beforePath'],
        ['--after', 'afterPath'],
        ['--guest-base', 'guestBase'],
        ['--guest-start', 'guestStart'],
        ['--before-hud', 'beforeValue'],
        ['--after-hud', 'afterValue'],
        ['--alignment', 'alignment']
    ]);

    for (let index = 0; index < args.length; index += 1) {
        const option = valueOptions.get(args[index]);
        if (!option) throw new Error(`Unknown argument: ${args[index]}`);
        if (Object.hasOwn(parsed, option)) throw new Error(`${args[index]} may be supplied only once`);
        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${args[index]} requires a value`);
        if (option === 'alignment') {
            const alignment = Number(value);
            if (!Number.isSafeInteger(alignment) || alignment < 4 || alignment % 4 !== 0) {
                throw new Error('--alignment must be a positive multiple of 4');
            }
            parsed[option] = alignment;
        } else {
            parsed[option] = value;
        }
        index += 1;
    }
    return parsed;
}

function isDirectExecution() {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
    try {
        const options = parseDiffArguments(process.argv.slice(2));
        const report = scanSnapshotFiles(options);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 2;
    }
}

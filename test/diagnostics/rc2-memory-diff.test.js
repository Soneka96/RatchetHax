import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    parseDiffArguments,
    scanBigEndianTransition,
    scanSnapshotFiles
} from '../../diagnostics/rc2-memory-diff.js';

const GUEST_BASE = 0x300000000n;
const GUEST_START = 0x012E0000n;

function transitionBuffers() {
    const before = Buffer.alloc(40);
    const after = Buffer.alloc(40);
    before.writeUInt32BE(244012, 0);
    before.writeUInt32BE(244012, 8);
    before.writeUInt32BE(244012, 16);
    before.writeUInt32BE(244012, 29); // Unaligned decoy.
    after.writeUInt32BE(244016, 0);
    after.writeUInt32BE(244016, 8);
    after.writeUInt32BE(244012, 16); // Unchanged value is not a hit.
    after.writeUInt32BE(244016, 29); // Unaligned decoy.
    return { before, after };
}

test('finds aligned big-endian changes and preserves guest/host address math', () => {
    const { before, after } = transitionBuffers();
    const report = scanBigEndianTransition({
        beforeBytes: before,
        afterBytes: after,
        guestBase: GUEST_BASE,
        guestStart: GUEST_START,
        beforeValue: 244012,
        afterValue: 244016
    });

    assert.equal(report.status, 'scan_complete');
    assert.equal(report.candidateCount, 2);
    assert.deepEqual(report.candidates.map(hit => hit.offsetBytes), [0, 8]);
    assert.equal(report.candidates[0].guestAddress, '0x00000000012e0000');
    assert.equal(report.candidates[0].hostAddress, '0x00000003012e0000');
    assert.equal(report.candidates[1].hostAddress, '0x00000003012e0008');
    assert.ok(report.candidates.every(hit => hit.byteOrder === 'big' && hit.verification.startsWith('candidate;')));
});

test('does not report unchanged values or little-endian-only matches', () => {
    const before = Buffer.alloc(12);
    const after = Buffer.alloc(12);
    before.writeUInt32LE(244012, 0);
    after.writeUInt32LE(244016, 0);
    before.writeUInt32BE(244012, 4);
    after.writeUInt32BE(244012, 4);

    const report = scanBigEndianTransition({
        beforeBytes: before,
        afterBytes: after,
        guestBase: GUEST_BASE,
        guestStart: GUEST_START,
        beforeValue: 244012,
        afterValue: 244016
    });

    assert.equal(report.candidateCount, 0);
});

test('validates snapshot lengths, guest bounds, values, and alignment', () => {
    const bytes = Buffer.alloc(8);
    const base = {
        beforeBytes: bytes,
        afterBytes: bytes,
        guestBase: GUEST_BASE,
        guestStart: GUEST_START,
        beforeValue: 1,
        afterValue: 2
    };

    assert.throws(() => scanBigEndianTransition({ ...base, afterBytes: Buffer.alloc(7) }), /lengths must match/);
    assert.throws(() => scanBigEndianTransition({ ...base, guestStart: 0xFFFFFFFCn, beforeBytes: Buffer.alloc(8), afterBytes: Buffer.alloc(8) }), /32-bit PS3 guest address space/);
    assert.throws(() => scanBigEndianTransition({ ...base, guestStart: GUEST_START + 1n }), /alignment/);
    assert.throws(() => scanBigEndianTransition({ ...base, alignment: 2 }), /multiple of 4/);
    assert.throws(() => scanBigEndianTransition({ ...base, beforeValue: 2, afterValue: 2 }), /must differ/);
    assert.throws(() => scanBigEndianTransition({ ...base, afterValue: 0x100000000 }), /32-bit integer/);
});

test('accepts the final aligned guest word and rejects host-address overflow', () => {
    const before = Buffer.alloc(4);
    const after = Buffer.alloc(4);
    before.writeUInt32BE(1);
    after.writeUInt32BE(2);

    const report = scanBigEndianTransition({
        beforeBytes: before,
        afterBytes: after,
        guestBase: GUEST_BASE,
        guestStart: 0xFFFFFFFCn,
        beforeValue: 1,
        afterValue: 2
    });
    assert.equal(report.candidates[0].guestAddress, '0x00000000fffffffc');

    assert.throws(() => scanBigEndianTransition({
        beforeBytes: before,
        afterBytes: after,
        guestBase: 0xFFFFFFFFFFFFFFFFn,
        guestStart: 0n,
        beforeValue: 1,
        afterValue: 2
    }), /unsigned 64-bit integer/);
});

test('loads snapshot sidecars, checks matching ranges, and uses their visible counts', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rc2-memory-diff-'));
    const beforePath = path.join(directory, 'before.bin');
    const afterPath = path.join(directory, 'after.bin');
    const { before, after } = transitionBuffers();
    const metadata = (snapshotFile, visibleBolts) => ({
        schemaVersion: 1,
        status: 'snapshot_complete',
        kind: 'raw-guest-memory-range',
        guestBase: '0x0000000300000000',
        guestStart: '0x012E0000',
        lengthBytes: before.byteLength,
        visibleBolts,
        snapshotFile
    });

    try {
        writeFileSync(beforePath, before);
        writeFileSync(afterPath, after);
        writeFileSync(`${beforePath}.meta.json`, JSON.stringify(metadata(beforePath, 244012)));
        writeFileSync(`${afterPath}.meta.json`, JSON.stringify(metadata(afterPath, 244016)));

        const report = scanSnapshotFiles({ beforePath, afterPath });
        assert.equal(report.beforeHudBolts, 244012);
        assert.equal(report.afterHudBolts, 244016);
        assert.equal(report.candidateCount, 2);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('uses one sidecar with explicit after count, and supports snapshots without sidecars', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rc2-memory-diff-'));
    const beforePath = path.join(directory, 'before.bin');
    const afterPath = path.join(directory, 'after.bin');
    const { before, after } = transitionBuffers();
    const beforeMetadata = {
        status: 'snapshot_complete',
        kind: 'raw-guest-memory-range',
        guestBase: '0x0000000300000000',
        guestStart: '0x012E0000',
        lengthBytes: before.byteLength,
        visibleBolts: 244012,
        snapshotFile: beforePath
    };

    try {
        writeFileSync(beforePath, before);
        writeFileSync(afterPath, after);
        writeFileSync(`${beforePath}.meta.json`, JSON.stringify(beforeMetadata));
        const withOneSidecar = scanSnapshotFiles({ afterPath, beforePath, afterValue: 244016 });
        assert.equal(withOneSidecar.candidateCount, 2);

        rmSync(`${beforePath}.meta.json`);
        const withoutSidecars = scanSnapshotFiles({
            beforePath,
            afterPath,
            guestBase: '0x300000000',
            guestStart: '0x012E0000',
            beforeValue: 244012,
            afterValue: 244016
        });
        assert.equal(withoutSidecars.candidateCount, 2);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('rejects incompatible metadata and metadata lengths that do not match the file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rc2-memory-diff-'));
    const beforePath = path.join(directory, 'before.bin');
    const afterPath = path.join(directory, 'after.bin');
    const metadata = (snapshotFile, guestStart, lengthBytes) => ({
        status: 'snapshot_complete',
        kind: 'raw-guest-memory-range',
        guestBase: '0x0000000300000000',
        guestStart,
        lengthBytes,
        visibleBolts: 244012,
        snapshotFile
    });

    try {
        writeFileSync(beforePath, Buffer.alloc(8));
        writeFileSync(afterPath, Buffer.alloc(8));
        writeFileSync(`${beforePath}.meta.json`, JSON.stringify(metadata(beforePath, '0x012E0000', 8)));
        writeFileSync(`${afterPath}.meta.json`, JSON.stringify(metadata(afterPath, '0x012F0000', 8)));
        assert.throws(() => scanSnapshotFiles({ beforePath, afterPath }), /metadata differs for guestStart/);

        writeFileSync(`${afterPath}.meta.json`, JSON.stringify(metadata(afterPath, '0x012E0000', 8)));
        assert.throws(() => scanSnapshotFiles({ beforePath, afterPath, guestStart: '0x012F0000' }), /guestStart override conflicts/);

        writeFileSync(`${beforePath}.meta.json`, JSON.stringify(metadata(beforePath, '0x012E0000', 9)));
        writeFileSync(`${afterPath}.meta.json`, JSON.stringify(metadata(afterPath, '0x012E0000', 9)));
        assert.throws(() => scanSnapshotFiles({ beforePath, afterPath }), /length does not match its metadata/);

        writeFileSync(`${beforePath}.meta.json`, '{invalid json');
        assert.throws(() => scanSnapshotFiles({ beforePath, afterPath }), SyntaxError);
        writeFileSync(`${beforePath}.meta.json`, JSON.stringify(metadata(afterPath, '0x012E0000', 8)));
        assert.throws(() => scanSnapshotFiles({ beforePath, afterPath }), /path does not match/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('parses the offline scan command options', () => {
    assert.deepEqual(parseDiffArguments([
        '--before', 'before.bin', '--after', 'after.bin',
        '--guest-base', '0x300000000', '--guest-start', '0x012E0000',
        '--before-hud', '244012', '--after-hud', '244016', '--alignment', '4'
    ]), {
        beforePath: 'before.bin',
        afterPath: 'after.bin',
        guestBase: '0x300000000',
        guestStart: '0x012E0000',
        beforeValue: '244012',
        afterValue: '244016',
        alignment: 4
    });
    assert.throws(() => parseDiffArguments(['--before']), /requires a value/);
    assert.throws(() => parseDiffArguments(['--unexpected', 'x']), /Unknown argument/);
    assert.throws(() => parseDiffArguments(['--alignment', 'nope']), {
        name: 'Error',
        message: '--alignment must be a positive multiple of 4'
    });
    assert.throws(() => parseDiffArguments(['--alignment', '4', '--alignment', '8']), /only once/);
});

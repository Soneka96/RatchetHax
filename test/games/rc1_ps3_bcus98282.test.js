import assert from 'node:assert/strict';
import test from 'node:test';

import profile from '../../games/rc1_ps3_bcus98282.js';

test('identifies the Collection RC1 title and the observed RC1 save namespace', () => {
    assert.deepEqual(profile.collection, {
        titleId: 'BCUS98282',
        gameNumber: 1,
        gameTitle: 'Ratchet & Clank',
        observedSaveId: 'NPUA80643_RC1_SAVEDATA_A'
    });
});

test('uses the validated big-endian bolt field and enables the selected RC1 profile', () => {
    assert.equal(profile.boltOnly, true);
    assert.equal(profile.writeEnabled, true);
    assert.equal(profile.bigEndian, true);
    assert.equal(profile.rpcS3GuestBase, 0x300000000);
    assert.equal(profile.boltsGuestOffset, 0x009BC3A0);
    assert.deepEqual(profile.bolts, [0x3009BC3A0, 'uint32']);
    assert.equal(profile.rpcS3GuestBase + profile.boltsGuestOffset, profile.bolts[0]);
});

test('contains no unsupported game fields', () => {
    assert.deepEqual(Object.keys(profile).sort(), [
        'bigEndian', 'boltOnly', 'bolts', 'boltsGuestOffset', 'collection',
        'rpcS3GuestBase', 'writeEnabled'
    ]);
});

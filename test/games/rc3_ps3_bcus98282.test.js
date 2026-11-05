import assert from 'node:assert/strict';
import test from 'node:test';

import profile from '../../games/rc3_ps3_bcus98282.js';

test('identifies Collection RC3 from the observed RC3 save namespace', () => {
    assert.deepEqual(profile.collection, {
        titleId: 'BCUS98282',
        gameNumber: 3,
        gameTitle: 'Ratchet & Clank 3: Up Your Arsenal',
        observedSaveId: 'NPUA80645_RC3_SAVEDATA_A'
    });
});

test('uses the tested big-endian RC3 Collection bolt address', () => {
    assert.equal(profile.boltOnly, true);
    assert.equal(profile.writeEnabled, true);
    assert.equal(profile.bigEndian, true);
    assert.equal(profile.rpcS3GuestBase, 0x300000000);
    assert.equal(profile.boltsGuestOffset, 0x00C1EDAC);
    assert.deepEqual(profile.bolts, [0x300C1EDAC, 'uint32']);
    assert.equal(profile.rpcS3GuestBase + profile.boltsGuestOffset, profile.bolts[0]);
});

test('contains only supported bolt metadata', () => {
    assert.deepEqual(Object.keys(profile).sort(), [
        'bigEndian', 'boltOnly', 'bolts', 'boltsGuestOffset', 'collection', 'rpcS3GuestBase', 'writeEnabled'
    ]);
});

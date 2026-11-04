import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import profile from '../../games/rc2_ps3_bcus98282.js';

test('identifies RC2 by Collection title and inner app identifiers', () => {
    assert.deepEqual(profile.collection, {
        titleId: 'BCUS98282',
        gameNumber: 2,
        gameTitle: 'Ratchet & Clank 2: Going Commando',
        innerAppId: 'NPUA80644'
    });
    assert.equal(path.basename(new URL('../../games/rc2_ps3_bcus98282.js', import.meta.url).pathname, '.js'), 'rc2_ps3_bcus98282');
});

test('exposes the confirmed bolt address with big-endian uint32 decoding', () => {
    assert.equal(profile.boltOnly, true);
    assert.equal(profile.bigEndian, true);
    assert.equal(profile.rpcS3GuestBase, 0x300000000);
    assert.equal(profile.boltsGuestOffset, 0x01329E80);
    assert.deepEqual(profile.bolts, [0x301329E80, 'uint32']);
    assert.equal(profile.rpcS3GuestBase + profile.boltsGuestOffset, profile.bolts[0]);
});

test('leaves all unvalidated address tables and fields absent', () => {
    assert.deepEqual(Object.keys(profile).sort(), [
        'bigEndian', 'boltOnly', 'bolts', 'boltsGuestOffset', 'collection', 'rpcS3GuestBase'
    ]);
});

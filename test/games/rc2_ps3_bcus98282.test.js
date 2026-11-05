import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import profile from '../../games/rc2_ps3_bcus98282.js';

test('uses the Collection title and RC2 inner app identity', () => {
    assert.equal(basename(fileURLToPath(new URL('../../games/rc2_ps3_bcus98282.js', import.meta.url)), '.js'), 'rc2_ps3_bcus98282');
    assert.deepEqual(profile.collection, {
        titleId: 'BCUS98282',
        gameNumber: 2,
        gameTitle: 'Ratchet & Clank 2: Going Commando',
        innerAppId: 'NPUA80644'
    });
});

test('uses the confirmed big-endian bolt address and guest-base arithmetic', () => {
    assert.equal(profile.bigEndian, true);
    assert.equal(profile.boltOnly, true);
    assert.equal(profile.writeEnabled, true);
    assert.equal(profile.rpcS3GuestBase, 0x300000000);
    assert.equal(profile.boltsGuestOffset, 0x01329E80);
    assert.deepEqual(profile.bolts, [0x301329E80, 'uint32']);
    assert.equal(profile.rpcS3GuestBase + profile.boltsGuestOffset, profile.bolts[0]);
});

test('contains only the supported bolt address and reusable Collection metadata', () => {
    assert.deepEqual(Object.keys(profile).sort(), [
        'bigEndian', 'boltOnly', 'bolts', 'boltsGuestOffset', 'collection', 'rpcS3GuestBase', 'writeEnabled'
    ]);
});

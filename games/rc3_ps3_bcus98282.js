/*
 * Bolt-only profile for Ratchet & Clank 3: Up Your Arsenal inside the PS3
 * Collection. The bolt field was verified in the tested RC3 session.
 */

export default {
    collection: {
        titleId: 'BCUS98282',
        gameNumber: 3,
        gameTitle: 'Ratchet & Clank 3: Up Your Arsenal',
        observedSaveId: 'NPUA80645_RC3_SAVEDATA_A'
    },
    boltOnly: true,
    writeEnabled: true,
    bigEndian: true,
    rpcS3GuestBase: 0x300000000,
    boltsGuestOffset: 0x00C1EDAC,
    bolts: [0x300C1EDAC, 'uint32']
};

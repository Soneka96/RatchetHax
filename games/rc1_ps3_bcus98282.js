/*
 * Bolt-only profile for Ratchet & Clank 1 inside the PS3 Collection.
 * The bolt field was confirmed in the tested session. Choose this profile only
 * while Collection Game 1 is running; the outer Collection title is shared.
 */

export default {
    collection: {
        titleId: 'BCUS98282',
        gameNumber: 1,
        gameTitle: 'Ratchet & Clank',
        observedSaveId: 'NPUA80643_RC1_SAVEDATA_A'
    },
    boltOnly: true,
    writeEnabled: true,
    bigEndian: true,
    rpcS3GuestBase: 0x300000000,
    boltsGuestOffset: 0x009BC3A0,
    bolts: [0x3009BC3A0, 'uint32']
};

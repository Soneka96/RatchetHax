/*
 * Bolt-only profile for Ratchet & Clank 2: Going Commando inside the PS3
 * Collection. The address was validated for the local RPCS3 mapping recorded
 * below; other game fields are intentionally unsupported.
 */

export default {
    collection: {
        titleId: 'BCUS98282',
        gameNumber: 2,
        gameTitle: 'Ratchet & Clank 2: Going Commando',
        innerAppId: 'NPUA80644'
    },
    boltOnly: true,
    bigEndian: true,
    rpcS3GuestBase: 0x300000000,
    boltsGuestOffset: 0x01329E80,
    bolts: [0x301329E80, 'uint32']
};

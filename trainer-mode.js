export const COLLECTION_RC2_BOLT_PROFILE = 'rc2_ps3_bcus98282';

export function getCollectionBoltProfileChoice() {
    return {
        name: 'Ratchet & Clank 2: Going Commando [Collection BCUS98282] - Bolts only',
        value: COLLECTION_RC2_BOLT_PROFILE
    };
}

export function isBoltOnlyProfile(profile) {
    return profile?.boltOnly === true;
}

export function getBoltOnlyMenuChoices() {
    return [
        { name: 'Refresh Bolt Count', value: 'refresh' },
        { name: 'Set Bolts', value: 'setBolts' },
        { name: 'Quit', value: 'quit' }
    ];
}

export async function runBoltOnlyMenu({ prompt, readBolts, setBolts, quit, renderBolts, clear }) {
    if (typeof prompt !== 'function' || typeof readBolts !== 'function' || typeof setBolts !== 'function' ||
        typeof quit !== 'function' || typeof renderBolts !== 'function' || typeof clear !== 'function') {
        throw new TypeError('Bolt-only menu requires prompt, read, set, quit, render, and clear callbacks.');
    }

    while (true) {
        renderBolts(readBolts());
        const answer = await prompt({
            type: 'list',
            name: 'action',
            message: 'Bolt options:',
            choices: getBoltOnlyMenuChoices()
        });
        clear();

        if (answer.action === 'refresh') continue;
        if (answer.action === 'setBolts') {
            await setBolts();
            continue;
        }
        if (answer.action === 'quit') {
            await quit();
            return;
        }
        throw new Error(`Unsupported bolt-only trainer action: ${answer.action}`);
    }
}

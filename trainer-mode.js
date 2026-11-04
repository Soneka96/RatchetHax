export const COLLECTION_RC2_BOLT_PROFILE = 'rc2_ps3_bcus98282';
export const COLLECTION_RC1_BOLT_PROFILE = 'rc1_ps3_bcus98282';

export function getCollectionRc1BoltProfileChoice() {
    return {
        name: 'Ratchet & Clank 1 [Collection BCUS98282] - Bolts only',
        value: COLLECTION_RC1_BOLT_PROFILE
    };
}

export function getCollectionBoltProfileChoice() {
    return {
        name: 'Ratchet & Clank 2: Going Commando [Collection BCUS98282] - Bolts only',
        value: COLLECTION_RC2_BOLT_PROFILE
    };
}

export function isBoltOnlyProfile(profile) {
    return profile?.boltOnly === true;
}

export function getBoltOnlyMenuAccess(profile) {
    return {
        allowSetBolts: profile?.writeEnabled === true,
        setBoltsDisabledReason: profile?.writeBlockReason || 'runtime game identity is unverified'
    };
}

export function getBoltOnlyMemoryActions(profile, {
    readBolts,
    setBolts,
    readCollectionRc1Bolts,
    setCollectionRc1Bolts
}) {
    if (typeof readBolts !== 'function' || typeof setBolts !== 'function' ||
        typeof readCollectionRc1Bolts !== 'function' || typeof setCollectionRc1Bolts !== 'function') {
        throw new TypeError('Bolt-only memory actions require default and RC1 read/set callbacks.');
    }

    const isCollectionRc1 = profile?.boltOnly === true &&
        profile.collection?.titleId === 'BCUS98282' && profile.collection?.gameNumber === 1;
    return isCollectionRc1
        ? { readBolts: readCollectionRc1Bolts, setBolts: setCollectionRc1Bolts }
        : { readBolts, setBolts };
}

export function getBoltOnlyMenuChoices({ allowSetBolts = true, setBoltsDisabledReason = 'runtime game identity is unverified' } = {}) {
    const choices = [
        { name: 'Refresh Bolt Count', value: 'refresh' },
    ];
    choices.push(allowSetBolts
        ? { name: 'Set Bolts', value: 'setBolts' }
        : { name: `Set Bolts (disabled: ${setBoltsDisabledReason})`, value: 'setBolts', disabled: setBoltsDisabledReason });
    choices.push({ name: 'Quit', value: 'quit' });
    return choices;
}

export async function runBoltOnlyMenu({
    prompt,
    readBolts,
    setBolts,
    quit,
    renderBolts,
    clear,
    allowSetBolts = true,
    setBoltsDisabledReason = 'runtime game identity is unverified'
}) {
    if (typeof prompt !== 'function' || typeof readBolts !== 'function' || typeof setBolts !== 'function' ||
        typeof quit !== 'function' || typeof renderBolts !== 'function' || typeof clear !== 'function') {
        throw new TypeError('Bolt-only menu requires prompt, read, set, quit, render, and clear callbacks.');
    }

    while (true) {
        renderBolts(readBolts());
        const answer = await prompt({
            type: 'list',
            name: 'action',
            message: allowSetBolts ? 'Bolt options:' : 'Bolts (read-only):',
            choices: getBoltOnlyMenuChoices({ allowSetBolts, setBoltsDisabledReason })
        });
        clear();

        if (answer.action === 'refresh') continue;
        if (answer.action === 'setBolts') {
            if (!allowSetBolts) throw new Error('Set Bolts is disabled for this profile.');
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

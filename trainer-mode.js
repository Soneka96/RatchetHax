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

export async function setBoltCountAndVerify({ readBolts, writeBolts, value }) {
    if (typeof readBolts !== 'function' || typeof writeBolts !== 'function') {
        throw new TypeError('Set Bolts requires read and write callbacks.');
    }
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xFFFFFFFF) {
        throw new RangeError('Bolt count must be an unsigned 32-bit integer.');
    }

    await writeBolts(value);
    const actual = await readBolts();
    if (actual !== value) {
        throw new Error(`Bolt write verification failed: requested ${value}, read ${actual}.`);
    }
    return actual;
}

export async function promptAndSetBolts({ prompt, readBolts, writeBolts }) {
    if (typeof prompt !== 'function' || typeof readBolts !== 'function' || typeof writeBolts !== 'function') {
        throw new TypeError('Set Bolts requires prompt, read, and write callbacks.');
    }
    const currentValue = await readBolts();
    const answer = await prompt({
        type: 'number',
        name: 'bolts',
        default: currentValue,
        message: 'Enter new bolt count:'
    });
    return setBoltCountAndVerify({ readBolts, writeBolts, value: answer?.bolts });
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
            return await quit();
        }
        throw new Error(`Unsupported bolt-only trainer action: ${answer.action}`);
    }
}

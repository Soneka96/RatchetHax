import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import profile from '../games/rc2_ps3_bcus98282.js';
import rc1CollectionProfile from '../games/rc1_ps3_bcus98282.js';
import {
    getBoltOnlyMenuChoices,
    getBoltOnlyMenuAccess,
    getBoltOnlyMemoryActions,
    getCollectionBoltProfileChoice,
    getCollectionRc1BoltProfileChoice,
    isBoltOnlyProfile,
    runBoltOnlyMenu
} from '../trainer-mode.js';

const trainerPath = fileURLToPath(new URL('../trainer.js', import.meta.url));
const trainerSource = readFileSync(trainerPath, 'utf8');

test('registers the correctly named Collection RC2 bolt-only build', () => {
    assert.deepEqual(getCollectionBoltProfileChoice(), {
        name: 'Ratchet & Clank 2: Going Commando [Collection BCUS98282] - Bolts only',
        value: 'rc2_ps3_bcus98282'
    });
    assert.equal(isBoltOnlyProfile(profile), true);
    assert.equal(isBoltOnlyProfile(rc1CollectionProfile), true);
    assert.equal(isBoltOnlyProfile({}), false);
});

test('registers Collection RC1 as a separate bolt-only profile', () => {
    assert.deepEqual(getCollectionRc1BoltProfileChoice(), {
        name: 'Ratchet & Clank 1 [Collection BCUS98282] - Bolts only',
        value: 'rc1_ps3_bcus98282'
    });
    assert.notDeepEqual(rc1CollectionProfile.bolts, profile.bolts);
    assert.deepEqual(getBoltOnlyMenuAccess(rc1CollectionProfile), {
        allowSetBolts: true,
        setBoltsDisabledReason: 'runtime game identity is unverified'
    });
    assert.equal(rc1CollectionProfile.writeEnabled, true);
    assert.equal(profile.writeEnabled, true);
});

test('routes RC1 to its checked memory callbacks and leaves RC2 on its existing callbacks', () => {
    const defaultRead = () => 'rc2-read';
    const defaultSet = () => 'rc2-set';
    const rc1Read = () => 'rc1-read';
    const rc1Set = () => 'rc1-set';
    const callbacks = {
        readBolts: defaultRead,
        setBolts: defaultSet,
        readCollectionRc1Bolts: rc1Read,
        setCollectionRc1Bolts: rc1Set
    };

    assert.deepEqual(getBoltOnlyMemoryActions(rc1CollectionProfile, callbacks), {
        readBolts: rc1Read,
        setBolts: rc1Set
    });
    assert.deepEqual(getBoltOnlyMemoryActions(profile, callbacks), {
        readBolts: defaultRead,
        setBolts: defaultSet
    });
    assert.throws(() => getBoltOnlyMemoryActions(rc1CollectionProfile, {}), /callbacks/);
});

test('dispatches Set Bolts to the profile-specific callback in the bolt-only menu', async () => {
    const calls = [];
    const callbacks = {
        readBolts: () => 244016,
        setBolts: async () => { calls.push('rc2'); },
        readCollectionRc1Bolts: () => 99453,
        setCollectionRc1Bolts: async () => { calls.push('rc1'); }
    };
    const rc1Actions = getBoltOnlyMemoryActions(rc1CollectionProfile, callbacks);
    const rc2Actions = getBoltOnlyMemoryActions(profile, callbacks);

    for (const actions of [rc1Actions, rc2Actions]) {
        const selected = ['setBolts', 'quit'];
        await runBoltOnlyMenu({
            prompt: async () => ({ action: selected.shift() }),
            ...actions,
            quit: async () => {},
            renderBolts: () => {},
            clear: () => {}
        });
    }

    assert.deepEqual(calls, ['rc1', 'rc2']);
});

test('exposes only bolt display, bolt setting, refresh, and quit actions', () => {
    const choices = getBoltOnlyMenuChoices();

    assert.deepEqual(choices.map(choice => choice.value), ['refresh', 'setBolts', 'quit']);
    assert.ok(choices.every(choice => !/health|weapon|gadget|item|planet|teleport|coordinate/i.test(choice.name)));
});

test('exposes RC1 Set Bolts with only bolt, refresh, and quit actions', () => {
    const menuAccess = getBoltOnlyMenuAccess(rc1CollectionProfile);
    const choices = getBoltOnlyMenuChoices(menuAccess);
    const setChoice = choices.find(choice => choice.value === 'setBolts');

    assert.deepEqual(choices.map(choice => choice.value), ['refresh', 'setBolts', 'quit']);
    assert.equal(setChoice.disabled, undefined);
    assert.ok(choices.every(choice => !/health|weapon|gadget|item|planet|teleport|coordinate/i.test(choice.name)));
});

test('preserves the guarded menu path for profiles whose writes are disabled', () => {
    const choices = getBoltOnlyMenuChoices({
        allowSetBolts: false,
        setBoltsDisabledReason: 'RC1 runtime identity guard is not verified'
    });
    const setChoice = choices.find(choice => choice.value === 'setBolts');

    assert.deepEqual(choices.map(choice => choice.value), ['refresh', 'setBolts', 'quit']);
    assert.equal(setChoice.disabled, 'RC1 runtime identity guard is not verified');
    assert.ok(choices.every(choice => !/health|weapon|gadget|item|planet|teleport|coordinate/i.test(choice.name)));
});

test('blocks an injected Set Bolts action when profile writes are disabled', async () => {
    let setCalls = 0;
    let quitCalls = 0;

    await assert.rejects(runBoltOnlyMenu({
        prompt: async () => ({ action: 'setBolts' }),
        readBolts: () => 5055,
        setBolts: async () => { setCalls += 1; },
        quit: async () => { quitCalls += 1; },
        renderBolts: () => {},
        clear: () => {},
        allowSetBolts: false,
        setBoltsDisabledReason: 'unsupported profile'
    }), /Set Bolts is disabled for this profile/);

    assert.equal(setCalls, 0);
    assert.equal(quitCalls, 0);
});

test('refreshes bolt display and routes Set Bolts without touching other values', async () => {
    let bolts = 244016;
    let setCalls = 0;
    let quitCalls = 0;
    let clearCalls = 0;
    const rendered = [];
    const prompts = [];
    const actions = ['refresh', 'setBolts', 'quit'];

    await runBoltOnlyMenu({
        prompt: async options => {
            prompts.push(options);
            return { action: actions.shift() };
        },
        readBolts: () => bolts,
        setBolts: async () => { setCalls += 1; bolts += 1000; },
        quit: async () => { quitCalls += 1; },
        renderBolts: value => rendered.push(value),
        clear: () => { clearCalls += 1; }
    });

    assert.deepEqual(rendered, [244016, 244016, 245016]);
    assert.equal(setCalls, 1);
    assert.equal(quitCalls, 1);
    assert.equal(clearCalls, 3);
    assert.ok(prompts.every(options => options.choices.map(choice => choice.value).join(',') === 'refresh,setBolts,quit'));
});

test('rejects an action outside the bolt-only menu', async () => {
    let setCalls = 0;
    let quitCalls = 0;

    await assert.rejects(runBoltOnlyMenu({
        prompt: async () => ({ action: 'teleport' }),
        readBolts: () => 244016,
        setBolts: async () => { setCalls += 1; },
        quit: async () => { quitCalls += 1; },
        renderBolts: () => {},
        clear: () => {}
    }), /Unsupported bolt-only trainer action/);

    assert.equal(setCalls, 0);
    assert.equal(quitCalls, 0);
});

test('routes both Collection profiles through bolt-only handling before generic trainer reads', () => {
    assert.match(trainerSource, /getCollectionBoltProfileChoice\(\)/);
    assert.match(trainerSource, /getCollectionRc1BoltProfileChoice\(\)/);
    assert.match(trainerSource, /runBoltOnlyMenu\(/);
    assert.match(trainerSource, /const menuAccess = getBoltOnlyMenuAccess\(game\.address\)/);
    assert.match(trainerSource, /readBolts: \(\) => game\.bolts/);
    assert.match(trainerSource, /setBolts,/);
    assert.match(trainerSource, /getBoltOnlyMemoryActions\(game\.address/);
    const mainStart = trainerSource.indexOf('async function main()');
    const boltOnlyBranch = trainerSource.indexOf('if (isBoltOnlyProfile(game.address)) return await boltOnlyMain();', mainStart);
    const genericMenu = trainerSource.indexOf("console.log(chalk.bold.green('─── Main Menu ───'))", mainStart);
    assert.ok(mainStart >= 0);
    assert.ok(boltOnlyBranch > mainStart);
    assert.ok(genericMenu > boltOnlyBranch, 'bolt-only routing must happen before generic menu reads');
    assert.match(trainerSource, /Bolts: '\) \+ game\.bolts/);
});

test('trainer.js parses after the integration change', () => {
    const result = spawnSync(process.execPath, ['--check', trainerPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

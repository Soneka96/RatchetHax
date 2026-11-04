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
    getCollectionBoltProfileChoice,
    getCollectionRc1BoltProfileChoice,
    isBoltOnlyProfile,
    promptAndSetBolts,
    runBoltOnlyMenu,
    setBoltCountAndVerify
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

test('keeps RC1 and RC2 addresses separate while sharing the Set Bolts verifier', async () => {
    assert.notDeepEqual(rc1CollectionProfile.bolts, profile.bolts);
    let current = 99453;
    const writes = [];
    const verified = await setBoltCountAndVerify({
        readBolts: () => current,
        writeBolts: value => { writes.push(value); current = value; },
        value: 105055
    });

    assert.deepEqual(writes, [105055]);
    assert.equal(verified, 105055);
});

test('rejects failed or invalid bolt writes in the shared Set Bolts verifier', async () => {
    let writeCalls = 0;

    await assert.rejects(setBoltCountAndVerify({
        readBolts: () => 99453,
        writeBolts: () => { writeCalls += 1; },
        value: 105055
    }), /Bolt write verification failed/);
    await assert.rejects(setBoltCountAndVerify({
        readBolts: () => 0,
        writeBolts: () => { writeCalls += 1; },
        value: -1
    }), /unsigned 32-bit integer/);
    for (const value of [0x100000000, 1.5, Number.NaN]) {
        await assert.rejects(setBoltCountAndVerify({
            readBolts: () => 0,
            writeBolts: () => { writeCalls += 1; },
            value
        }), /unsigned 32-bit integer/);
    }
    await assert.rejects(setBoltCountAndVerify({
        readBolts: () => { throw new Error('read callback failed'); },
        writeBolts: () => {},
        value: 1
    }), /read callback failed/);
    await assert.rejects(setBoltCountAndVerify({
        readBolts: () => 1,
        writeBolts: () => { throw new Error('write callback failed'); },
        value: 1
    }), /write callback failed/);

    assert.equal(writeCalls, 1, 'invalid values must be rejected before writing');
});

test('prompts with the shared bolt count and verifies the chosen value', async () => {
    let current = 99453;
    let writeCalls = 0;
    const prompts = [];
    const verified = await promptAndSetBolts({
        prompt: async questions => { prompts.push(questions); return { bolts: 105055 }; },
        readBolts: () => current,
        writeBolts: value => { writeCalls += 1; current = value; }
    });

    assert.deepEqual(prompts, [{
        type: 'number', name: 'bolts', default: 99453, message: 'Enter new bolt count:'
    }]);
    assert.equal(writeCalls, 1);
    assert.equal(verified, 105055);
});

test('rejects an invalid prompted count before invoking the shared writer', async () => {
    let writeCalls = 0;
    await assert.rejects(promptAndSetBolts({
        prompt: async () => ({ bolts: 0x100000000 }),
        readBolts: () => 99453,
        writeBolts: () => { writeCalls += 1; }
    }), /unsigned 32-bit integer/);
    assert.equal(writeCalls, 0);
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

test('returns the Quit callback result to the outer setup flow', async () => {
    const returnToGameSelection = Symbol('select-another-game');
    const result = await runBoltOnlyMenu({
        prompt: async () => ({ action: 'quit' }),
        readBolts: () => 99453,
        setBolts: async () => {},
        quit: async () => returnToGameSelection,
        renderBolts: () => {},
        clear: () => {}
    });

    assert.equal(result, returnToGameSelection);
});

test('routes both Collection profiles through bolt-only handling before generic trainer reads', () => {
    assert.match(trainerSource, /getCollectionBoltProfileChoice\(\)/);
    assert.match(trainerSource, /getCollectionRc1BoltProfileChoice\(\)/);
    assert.match(trainerSource, /runBoltOnlyMenu\(/);
    assert.match(trainerSource, /const menuAccess = getBoltOnlyMenuAccess\(game\.address\)/);
    assert.match(trainerSource, /readBolts: \(\) => game\.bolts/);
    assert.match(trainerSource, /setBolts,/);
    assert.match(trainerSource, /promptAndSetBolts\(/);
    assert.doesNotMatch(trainerSource, /readCollectionBolts|writeCollectionBolts/);
    assert.match(trainerSource, /quit: quitBoltOnlyMenu/);
    assert.match(trainerSource, /return await runBoltOnlyMenu\(/);
    assert.match(trainerSource, /RETURN_TO_GAME_VERSION_LIST/);
    assert.match(trainerSource, /while \(result === RETURN_TO_GAME_VERSION_LIST\)/);
    assert.match(trainerSource, /replaceGameForSelection\(/);
    assert.match(trainerSource, /processIdentifier/);
    assert.match(trainerSource, /const processIdentifier = targetProcess\?\.id \|\| setup\.process/);
    assert.match(trainerSource, /new Game\(processIdentifier, setup\.version\)/);
    const mainStart = trainerSource.indexOf('async function main()');
    const boltOnlyBranch = trainerSource.indexOf('if (isBoltOnlyProfile(game.address)) return await boltOnlyMain();', mainStart);
    const genericMenu = trainerSource.indexOf("console.log(chalk.bold.green('─── Main Menu ───'))", mainStart);
    assert.ok(mainStart >= 0);
    assert.ok(boltOnlyBranch > mainStart);
    assert.ok(genericMenu > boltOnlyBranch, 'bolt-only routing must happen before generic menu reads');
    assert.match(trainerSource, /Bolts: '\) \+ game\.bolts/);
    const quitStart = trainerSource.indexOf('async function quitBoltOnlyMenu()');
    const quitEnd = trainerSource.indexOf('async function boltOnlyMain()', quitStart);
    const quitBoltOnlySource = trainerSource.slice(quitStart, quitEnd);
    assert.match(quitBoltOnlySource, /return RETURN_TO_GAME_VERSION_LIST/);
    assert.doesNotMatch(quitBoltOnlySource, /process\.exit/);
});

test('trainer.js parses after the integration change', () => {
    const result = spawnSync(process.execPath, ['--check', trainerPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import profile from '../games/rc2_ps3_bcus98282.js';
import {
    getBoltOnlyMenuChoices,
    getCollectionBoltProfileChoice,
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
    assert.equal(isBoltOnlyProfile({}), false);
});

test('exposes only bolt display, bolt setting, refresh, and quit actions', () => {
    const choices = getBoltOnlyMenuChoices();

    assert.deepEqual(choices.map(choice => choice.value), ['refresh', 'setBolts', 'quit']);
    assert.ok(choices.every(choice => !/health|weapon|gadget|item|planet|teleport|coordinate/i.test(choice.name)));
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

test('routes bolt-only profiles before the generic trainer reads other fields', () => {
    assert.match(trainerSource, /getCollectionBoltProfileChoice\(\)/);
    assert.match(trainerSource, /runBoltOnlyMenu\(/);
    assert.match(trainerSource, /readBolts: \(\) => game\.bolts/);
    assert.match(trainerSource, /setBolts,/);
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

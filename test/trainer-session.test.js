import assert from 'node:assert/strict';
import test from 'node:test';

import { runBoltOnlyMenu } from '../trainer-mode.js';
import { replaceGameForSelection } from '../trainer-session.js';

test('closes the current game and reopens the selected version on the same process', async () => {
    const order = [];
    const currentGame = { close: async () => { order.push('close'); } };
    const processIdentifier = 15324;
    const nextGame = { version: 'rc2_ps3_bcus98282' };
    const result = await replaceGameForSelection({
        closeGame: () => currentGame.close(),
        promptSelection: async () => { order.push('prompt'); return { version: nextGame.version }; },
        createGame: async (pid, version) => {
            order.push('create');
            assert.equal(pid, processIdentifier);
            assert.equal(version, nextGame.version);
            return nextGame;
        },
        processIdentifier
    });

    assert.deepEqual(order, ['close', 'prompt', 'create']);
    assert.equal(result.selection.version, nextGame.version);
    assert.equal(result.game, nextGame);
});

test('validates callbacks and rejects an empty version selection', async () => {
    await assert.rejects(replaceGameForSelection({}), /close, prompt, and create callbacks/);

    await assert.rejects(replaceGameForSelection({
        closeGame: async () => {},
        promptSelection: async () => ({ version: '' }),
        createGame: async () => ({})
    }), /must return a version/);
});

test('bolt-only Quit closes the current game once, then selects a version on the same process', async () => {
    const events = [];
    const processIdentifier = 15324;
    const currentGame = { close: async () => { events.push('close-current'); } };
    const returnToSelection = Symbol('return-to-version-list');
    const menuResult = await runBoltOnlyMenu({
        prompt: async () => ({ action: 'quit' }),
        readBolts: () => 99453,
        setBolts: async () => {},
        quit: async () => returnToSelection,
        renderBolts: () => {},
        clear: () => {}
    });

    assert.equal(menuResult, returnToSelection);
    const replacement = await replaceGameForSelection({
        closeGame: () => currentGame.close(),
        promptSelection: async () => { events.push('select-version'); return { version: 'rc2_ps3_bcus98282' }; },
        createGame: async (pid, version) => {
            events.push('create-game');
            assert.equal(pid, processIdentifier);
            assert.equal(version, 'rc2_ps3_bcus98282');
            return { version };
        },
        processIdentifier
    });

    assert.deepEqual(events, ['close-current', 'select-version', 'create-game']);
    assert.equal(replacement.game.version, 'rc2_ps3_bcus98282');
});

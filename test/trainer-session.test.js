import assert from 'node:assert/strict';
import test from 'node:test';

import memoryjs from 'memoryjs';
import Game from '../Game.js';
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

test('bolt-only Quit can reselect RC3 and later another profile on the same process', async () => {
    const events = [];
    const processIdentifier = 15324;
    let currentGame = { version: 'rc3_ps3_bcus98282', close: async () => { events.push(`close-${currentGame.version}`); } };
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
    const selectedVersions = ['rc3_ps3_bcus98282', 'rc1_ps2_scus97199'];
    const reselect = () => replaceGameForSelection({
        closeGame: () => currentGame.close(),
        promptSelection: async () => {
            events.push('select-version');
            return { version: selectedVersions.shift() };
        },
        createGame: async (pid, version) => {
            events.push(`create-${version}`);
            assert.equal(pid, processIdentifier);
            currentGame = { version, close: async () => { events.push(`close-${version}`); } };
            return currentGame;
        },
        processIdentifier
    });
    const rc3Replacement = await reselect();
    assert.equal(rc3Replacement.game.version, 'rc3_ps3_bcus98282');
    const otherReplacement = await reselect();

    assert.deepEqual(events, [
        'close-rc3_ps3_bcus98282', 'select-version', 'create-rc3_ps3_bcus98282',
        'close-rc3_ps3_bcus98282', 'select-version', 'create-rc1_ps2_scus97199'
    ]);
    assert.equal(otherReplacement.game.version, 'rc1_ps2_scus97199');
});

test('bolt-only Quit closes RC3 and constructs the next game on the selected process', async () => {
    const originalOpenProcess = memoryjs.openProcess;
    const originalCloseProcess = memoryjs.closeProcess;
    const originalReadMemory = memoryjs.readMemory;
    const originalWriteMemory = memoryjs.writeMemory;
    const typeNames = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT', 'DOUBLE'];
    const originalTypes = Object.fromEntries(typeNames.map(name => [name, memoryjs[name]]));
    const opened = [];
    const closed = [];
    const processId = 15324;
    memoryjs.openProcess = id => { opened.push(id); return { handle: id, th32ProcessID: id }; };
    memoryjs.closeProcess = handle => { closed.push(handle); };
    memoryjs.readMemory = () => 753;
    memoryjs.writeMemory = () => {};

    try {
        let game = new Game(processId, 'rc3_ps3_bcus98282');
        const menuResult = await runBoltOnlyMenu({
            prompt: async () => ({ action: 'quit' }),
            readBolts: () => game.bolts,
            setBolts: async () => {},
            quit: async () => {
                const replacement = await replaceGameForSelection({
                    closeGame: () => game.close(),
                    promptSelection: async () => ({ version: 'rc1_ps2_scus97199' }),
                    createGame: (pid, version) => new Game(pid, version),
                    processIdentifier: processId
                });
                game = replacement.game;
                return replacement.selection.version;
            },
            renderBolts: () => {},
            clear: () => {}
        });

        assert.equal(menuResult, 'rc1_ps2_scus97199');
        assert.deepEqual(opened, [processId, processId]);
        assert.deepEqual(closed, [processId]);
        assert.notEqual(game.address.bigEndian, true);
        assert.equal(memoryjs.UINT32, originalTypes.UINT32);
        game.close();
        assert.deepEqual(closed, [processId, processId]);
    } finally {
        memoryjs.openProcess = originalOpenProcess;
        memoryjs.closeProcess = originalCloseProcess;
        memoryjs.readMemory = originalReadMemory;
        memoryjs.writeMemory = originalWriteMemory;
        for (const name of typeNames) memoryjs[name] = originalTypes[name];
    }
});

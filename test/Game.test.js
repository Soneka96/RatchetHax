import assert from 'node:assert/strict';
import test from 'node:test';

import memoryjs from 'memoryjs';
import Game, { setMemoryEndianness } from '../Game.js';

test('switching from a Collection profile restores the default memoryjs types', () => {
    const names = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT', 'DOUBLE'];
    const memoryApi = {};
    for (const name of names) {
        memoryApi[name] = name.toLowerCase();
        memoryApi[`${name}_BE`] = `${name.toLowerCase()}_be`;
    }

    setMemoryEndianness(true, memoryApi);
    for (const name of names) assert.equal(memoryApi[name], `${name.toLowerCase()}_be`);

    setMemoryEndianness(false, memoryApi);
    for (const name of names) assert.equal(memoryApi[name], name.toLowerCase());
});

test('Game construction resets memoryjs endianness when returning to a PS2 profile', () => {
    const originalOpenProcess = memoryjs.openProcess;
    const originalCloseProcess = memoryjs.closeProcess;
    const names = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT', 'DOUBLE'];
    const originalTypes = Object.fromEntries(names.map(name => [name, memoryjs[name]]));
    memoryjs.openProcess = processId => ({ handle: processId });
    memoryjs.closeProcess = () => {};

    try {
        const collectionGame = new Game(17, 'rc1_ps3_bcus98282');
        assert.equal(memoryjs.UINT32, memoryjs.UINT32_BE);
        collectionGame.close();

        const ps2Game = new Game(17, 'rc1_ps2_scus97199');
        for (const name of names) assert.equal(memoryjs[name], originalTypes[name]);
        ps2Game.close();
    } finally {
        memoryjs.openProcess = originalOpenProcess;
        memoryjs.closeProcess = originalCloseProcess;
        for (const name of names) memoryjs[name] = originalTypes[name];
    }
});

test('Collection Game bolts use each profile address through the shared Game API', () => {
    const originalOpenProcess = memoryjs.openProcess;
    const originalCloseProcess = memoryjs.closeProcess;
    const originalReadMemory = memoryjs.readMemory;
    const originalWriteMemory = memoryjs.writeMemory;
    const typeNames = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT', 'DOUBLE'];
    const originalTypes = Object.fromEntries(typeNames.map(name => [name, memoryjs[name]]));
    const accesses = [];
    memoryjs.openProcess = processId => ({ handle: processId });
    memoryjs.closeProcess = () => {};
    memoryjs.readMemory = (handle, address, type) => {
        accesses.push({ action: 'read', address, type });
        return 99453;
    };
    memoryjs.writeMemory = (handle, address, value, type) => {
        accesses.push({ action: 'write', address, value, type });
    };

    try {
        for (const [version, address] of [
            ['rc1_ps3_bcus98282', 0x3009BC3A0],
            ['rc2_ps3_bcus98282', 0x301329E80],
            ['rc3_ps3_bcus98282', 0x300C1EDAC]
        ]) {
            const game = new Game(77, version);
            assert.equal(game.bolts, 99453);
            game.bolts = 100000;
            game.close();
            const calls = accesses.splice(0);
            assert.deepEqual(calls.map(call => [call.action, call.address, call.value, call.type]), [
                ['read', address, undefined, memoryjs.UINT32_BE],
                ['write', address, 100000, memoryjs.UINT32_BE]
            ]);
        }

        const ps2Game = new Game(77, 'rc1_ps2_scus97199');
        assert.equal(memoryjs.UINT32, originalTypes.UINT32);
        ps2Game.close();
    } finally {
        memoryjs.openProcess = originalOpenProcess;
        memoryjs.closeProcess = originalCloseProcess;
        memoryjs.readMemory = originalReadMemory;
        memoryjs.writeMemory = originalWriteMemory;
        for (const name of typeNames) memoryjs[name] = originalTypes[name];
    }
});

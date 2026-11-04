import assert from 'node:assert/strict';
import test from 'node:test';

import { readCollectionBolts, writeCollectionBolts } from '../trainer-memory.js';

const processId = 15324;
const address = 0x3009BC3A0;

test('reads Collection bolts through the checked 64-bit PowerShell backend', () => {
    let invocation;
    const report = readCollectionBolts({
        processId,
        address,
        runCommand: (...args) => {
            invocation = args;
            return {
                status: 0,
                stdout: JSON.stringify({
                    status: 'read_complete',
                    processId,
                    address: '0x00000003009BC3A0',
                    requestedBytes: 4,
                    bytesRead: 4,
                    value: 99453
                }),
                stderr: ''
            };
        }
    });

    assert.equal(invocation[0], 'powershell.exe');
    assert.ok(invocation[1].includes('-Mode'));
    assert.equal(invocation[1][invocation[1].indexOf('-Mode') + 1], 'read');
    assert.equal(invocation[1][invocation[1].indexOf('-Address') + 1], '0x00000003009bc3a0');
    assert.equal(invocation[2].windowsHide, true);
    assert.equal(report.value, 99453);
    assert.equal(report.bytesRead, 4);
});

test('writes only the requested 32-bit value and returns its verified read-back', () => {
    let invocation;
    const report = writeCollectionBolts({
        processId,
        address,
        value: 105055,
        runCommand: (...args) => {
            invocation = args;
            return {
                status: 0,
                stdout: JSON.stringify({
                    status: 'write_complete',
                    processId,
                    address: '0x00000003009BC3A0',
                    requestedBytes: 4,
                    bytesWritten: 4,
                    beforeValue: 99453,
                    value: 105055,
                    afterValue: 105055
                }),
                stderr: ''
            };
        }
    });

    assert.equal(invocation[1][invocation[1].indexOf('-Mode') + 1], 'write');
    assert.equal(invocation[1][invocation[1].indexOf('-Address') + 1], '0x00000003009bc3a0');
    assert.equal(invocation[1][invocation[1].indexOf('-Value') + 1], '105055');
    assert.equal(report.bytesWritten, 4);
    assert.equal(report.afterValue, 105055);
});

test('rejects invalid process IDs, addresses, and bolt counts before launching PowerShell', () => {
    let calls = 0;
    const runCommand = () => { calls += 1; };

    assert.throws(() => readCollectionBolts({ processId: 0, address, runCommand }), /processId/);
    assert.throws(() => readCollectionBolts({ processId, address: -1, runCommand }), /address/);
    assert.throws(() => writeCollectionBolts({ processId, address, value: -1, runCommand }), /unsigned 32-bit/);
    assert.throws(() => writeCollectionBolts({ processId, address, value: 0x100000000, runCommand }), /unsigned 32-bit/);
    assert.equal(calls, 0);
});

test('surfaces missing, malformed, and unsuccessful PowerShell results', () => {
    assert.throws(() => readCollectionBolts({
        processId,
        address,
        runCommand: () => ({ error: new Error('PowerShell unavailable') })
    }), /PowerShell unavailable/);

    assert.throws(() => readCollectionBolts({
        processId,
        address,
        runCommand: () => ({ status: 0, stdout: 'not json', stderr: '' })
    }), /Could not parse/);

    assert.throws(() => writeCollectionBolts({
        processId,
        address,
        value: 105055,
        runCommand: () => ({
            status: 3,
            stdout: JSON.stringify({ status: 'write_failed', errorCode: 5 }),
            stderr: ''
        })
    }), error => error.report?.status === 'write_failed');

    assert.throws(() => readCollectionBolts({
        processId,
        address,
        runCommand: () => ({ status: 7, stdout: '', stderr: '' })
    }), /exited with code 7/);
});

test('rejects nominal success reports with incomplete reads or mismatched write verification', () => {
    assert.throws(() => readCollectionBolts({
        processId,
        address,
        runCommand: () => ({
            status: 0,
            stdout: JSON.stringify({
                status: 'read_complete', processId, address: '0x00000003009bc3a0',
                requestedBytes: 4, bytesRead: 2, value: 99453
            })
        })
    }), /complete 32-bit/);

    assert.throws(() => writeCollectionBolts({
        processId,
        address,
        value: 105055,
        runCommand: () => ({
            status: 0,
            stdout: JSON.stringify({
                status: 'write_complete', processId, address: '0x00000003009bc3a0',
                requestedBytes: 4, bytesWritten: 4, afterValue: 105054
            })
        })
    }), /did not verify/);
});

test('surfaces write verification errors and read failures from the Win32 backend', () => {
    assert.throws(() => writeCollectionBolts({
        processId,
        address,
        value: 105055,
        runCommand: () => ({
            status: 3,
            stdout: JSON.stringify({ status: 'write_verify_failed', afterStatus: 'read_partial' }),
            stderr: ''
        })
    }), error => error.report?.status === 'write_verify_failed');

    assert.throws(() => readCollectionBolts({
        processId,
        address,
        runCommand: () => ({
            status: 3,
            stdout: JSON.stringify({ status: 'read_partial', bytesRead: 2 }),
            stderr: ''
        })
    }), error => error.report?.status === 'read_partial');
});

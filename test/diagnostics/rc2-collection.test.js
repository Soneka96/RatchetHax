import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCandidateRequests,
    buildProbeReport,
    invokePowerShellReader,
    parseProbeArguments,
    runCollectionProbe
} from '../../diagnostics/rc2-collection.js';

const smallProfile = {
    bigEndian: true,
    nanotech: [0x3014816AC, 'uint32'],
    bolts: [0x301329A90, 'uint32'],
    current: {
        item: [0x30147F1BB, 'uint8'],
        planet: [0x301329A3F, 'uint8']
    },
    weapons: {
        testweapon: {
            name: 'Test Weapon',
            unlocked: [0x301481A9E, 'uint8'],
            ammo: [0x3014818A4, 'uint32']
        },
        noammo: {
            name: 'No Ammo Weapon',
            unlocked: [0x301481A90, 'uint8'],
            ammo: false
        }
    },
    gadgets: {},
    items: {}
};

function rawRead(key, bytes, requestedBytes, success = true, bytesRead = requestedBytes, errorCode = 0) {
    const addresses = {
        bolts: '0x0000000301329a90',
        'current.planet': '0x0000000301329a3f',
        'current.item': '0x000000030147f1bb',
        'weapons.testweapon.unlocked': '0x0000000301481a9e',
        'weapons.testweapon.ammo': '0x00000003014818a4'
    };
    return {
        key,
        address: addresses[key],
        bytesBase64: Buffer.from(bytes).toString('base64'),
        requestedBytes,
        success,
        bytesRead,
        errorCode
    };
}

test('builds labeled requests only from existing NPUA80644 profile entries', () => {
    const requests = buildCandidateRequests(smallProfile);
    const byKey = new Map(requests.map(request => [request.key, request]));

    assert.equal(byKey.get('bolts').address, '0x0000000301329a90');
    assert.equal(byKey.get('bolts').requestedBytes, 4);
    assert.equal(byKey.get('health').label, 'Nanotech / health');
    assert.equal(byKey.get('weapons.testweapon.unlocked').requestedBytes, 1);
    assert.equal(byKey.get('weapons.testweapon.ammo').requestedBytes, 4);
    assert.equal(byKey.has('weapons.noammo.ammo'), false);
    assert.ok(requests.every(request => request.verification.includes('unverified')));
});

test('accepts a different source profile label without changing the RC2 default', () => {
    const request = buildCandidateRequests({ bigEndian: true, bolts: [0x3009B9CE0, 'int32'] }, {
        sourceProfile: 'NPUA80643'
    })[0];
    const rc2Request = buildCandidateRequests(smallProfile)[0];

    assert.equal(request.verification, 'unverified candidate copied from NPUA80643 profile');
    assert.equal(rc2Request.verification, 'unverified candidate copied from NPUA80644 profile');
});

test('reports complete zero reads as values and does not decode failed or partial reads', () => {
    const report = runCollectionProbe({
        profile: smallProfile,
        reader: ({ requests }) => ({
            status: 'read_complete',
            requestedAccess: 'PROCESS_VM_READ',
            process: { id: 321, name: 'rpcs3', path: 'C:\\RPCS3\\rpcs3.exe' },
            reads: [
                rawRead('bolts', [0, 0, 0, 0], 4),
                rawRead('current.planet', [0], 1, false, 0, 299),
                rawRead('current.item', [0], 1, false, 0, 299),
                rawRead('weapons.testweapon.unlocked', [1], 1, true, 1),
                rawRead('weapons.testweapon.ammo', [0, 0, 0, 0], 4, true, 2, 299)
            ]
        })
    });
    const byKey = new Map(report.fields.map(field => [field.key, field]));

    assert.equal(report.targetBuildStatus, 'unverified');
    assert.equal(report.sourceProfileStatus, 'unverified candidates only');
    assert.equal(report.writesEnabled, false);
    assert.equal(byKey.get('bolts').status, 'complete');
    assert.equal(byKey.get('bolts').value, 0);
    assert.equal(byKey.get('current.planet').status, 'failed');
    assert.equal(Object.hasOwn(byKey.get('current.planet'), 'value'), false);
    assert.equal(byKey.get('weapons.testweapon.unlocked').value, 1);
    assert.equal(byKey.get('weapons.testweapon.ammo').status, 'partial');
    assert.equal(Object.hasOwn(byKey.get('weapons.testweapon.ammo'), 'value'), false);
    assert.equal(byKey.get('weapons.noammo.unlocked').status, 'missing_result');
});

test('preserves process-selection and open-process failures in the report', () => {
    const selection = buildProbeReport({
        status: 'selection_required',
        processes: [{ id: 21, name: 'rpcs3' }, { id: 22, name: 'rpcs3' }]
    }, []);
    const openFailure = buildProbeReport({
        status: 'open_failed',
        process: { id: 21, name: 'rpcs3' },
        requestedAccess: 'PROCESS_VM_READ',
        errorCode: 5
    }, []);

    assert.equal(selection.status, 'selection_required');
    assert.equal(selection.processes.length, 2);
    assert.equal(openFailure.status, 'open_failed');
    assert.equal(openFailure.errorCode, 5);
    assert.equal(openFailure.requestedAccess, 'PROCESS_VM_READ');
});

test('rejects raw results that do not echo the requested candidate address and size', () => {
    const request = buildCandidateRequests(smallProfile).find(candidate => candidate.key === 'bolts');
    const report = buildProbeReport({
        status: 'read_complete',
        reads: [rawRead('bolts', [0, 0, 0, 7], 4)]
    }, [request]);
    const mismatch = buildProbeReport({
        status: 'read_complete',
        reads: [{
            ...rawRead('bolts', [0, 0, 0, 7], 4),
            address: '0x0000000301329a91'
        }]
    }, [request]);
    const sizeMismatch = buildProbeReport({
        status: 'read_complete',
        reads: [{ ...rawRead('bolts', [0, 0, 0, 7], 4), requestedBytes: 1 }]
    }, [request]);

    assert.equal(report.fields[0].status, 'complete');
    assert.equal(report.fields[0].value, 7);
    assert.equal(mismatch.fields[0].status, 'invalid_result');
    assert.match(mismatch.fields[0].error, /address does not match/);
    assert.equal(Object.hasOwn(mismatch.fields[0], 'value'), false);
    assert.equal(sizeMismatch.fields[0].status, 'invalid_result');
    assert.match(sizeMismatch.fields[0].error, /byte count does not match/);
    assert.equal(Object.hasOwn(sizeMismatch.fields[0], 'value'), false);
});

test('parses only a positive explicit RPCS3 process id and help options', () => {
    assert.deepEqual(parseProbeArguments(['--pid', '42']), { processId: 42 });
    assert.deepEqual(parseProbeArguments(['--pid', '42', '--out', 'capture.json']), {
        processId: 42, outputPath: 'capture.json'
    });
    assert.deepEqual(parseProbeArguments(['--help']), { help: true });
    assert.throws(() => parseProbeArguments(['--pid', '0']), /positive process ID/);
    assert.throws(() => parseProbeArguments(['--pid', '3.5']), /positive process ID/);
    assert.throws(() => parseProbeArguments(['--unknown']), /Unknown argument/);
    assert.throws(() => parseProbeArguments(['--out']), /requires a file path/);
});

test('invokes the read-only PowerShell backend with exact candidate addresses', () => {
    let invocation;
    const reader = invokePowerShellReader({
        processId: 42,
        requests: [{ key: 'bolts', address: '0x0000000301329a90', requestedBytes: 4 }],
        runCommand: (...args) => {
            invocation = args;
            return { stdout: '{"status":"open_failed","errorCode":5}', stderr: '', status: 0 };
        }
    });

    assert.equal(invocation[0], 'powershell.exe');
    assert.ok(invocation[1].includes('-ProcessId'));
    assert.ok(invocation[1].includes('42'));
    assert.ok(invocation[1].includes('-RequestsBase64'));
    const requestsBase64 = invocation[1][invocation[1].indexOf('-RequestsBase64') + 1];
    const requestsJsonLines = Buffer.from(requestsBase64, 'base64').toString('utf8');
    assert.deepEqual(requestsJsonLines.split('\n').map(line => JSON.parse(line)), [{
        key: 'bolts', address: '0x0000000301329a90', requestedBytes: 4
    }]);
    assert.deepEqual(reader, { status: 'open_failed', errorCode: 5 });
});

test('surfaces PowerShell launch and malformed-output failures', () => {
    const request = { requests: [] };
    assert.equal(invokePowerShellReader({
        ...request,
        runCommand: () => ({ error: new Error('powershell unavailable') })
    }).status, 'backend_unavailable');
    assert.equal(invokePowerShellReader({
        ...request,
        runCommand: () => ({ stdout: 'not json', stderr: 'native failure', status: 1 })
    }).status, 'backend_error');
});

test('surfaces empty PowerShell output with stderr or process exit details', () => {
    const withStderr = invokePowerShellReader({
        requests: [],
        runCommand: () => ({ stdout: '', stderr: 'reader failed', status: 1 })
    });
    const withoutStderr = invokePowerShellReader({
        requests: [],
        runCommand: () => ({ stdout: '', stderr: '', status: 7 })
    });

    assert.equal(withStderr.status, 'backend_error');
    assert.equal(withStderr.message, 'reader failed');
    assert.equal(withoutStderr.status, 'backend_error');
    assert.equal(withoutStderr.message, 'PowerShell exited with code 7');
});

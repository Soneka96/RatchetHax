import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildRc1CandidateRequests,
    runRc1CollectionProbe
} from '../../diagnostics/rc1-collection.js';

test('requests only the unverified standalone RC1 bolt candidate', () => {
    const requests = buildRc1CandidateRequests();

    assert.deepEqual(requests, [{
        key: 'bolts',
        label: 'Bolts',
        address: '0x00000003009b9ce0',
        dataType: 'int32',
        byteOrder: 'big',
        requestedBytes: 4,
        verification: 'unverified candidate copied from NPUA80643 profile'
    }]);
});

test('reports a complete candidate read without claiming build or write verification', () => {
    let observedRequests;
    const report = runRc1CollectionProbe({
        processId: 42,
        reader: ({ processId, requests }) => {
            assert.equal(processId, 42);
            observedRequests = requests;
            return {
                status: 'read_complete',
                requestedAccess: 'PROCESS_VM_READ',
                reads: [{
                    key: 'bolts',
                    address: requests[0].address,
                    requestedBytes: 4,
                    bytesRead: 4,
                    success: true,
                    errorCode: 0,
                    bytesBase64: Buffer.from([0, 0, 0, 7]).toString('base64')
                }]
            };
        }
    });

    assert.equal(observedRequests.length, 1);
    assert.equal(report.target, 'Ratchet & Clank 1 in the PS3 Collection (BCUS98282)');
    assert.equal(report.sourceProfile, 'rc1_ps3_npua80643');
    assert.equal(report.targetBuildStatus, 'unverified');
    assert.equal(report.sourceProfileStatus, 'unverified candidates only');
    assert.equal(report.writesEnabled, false);
    assert.equal(report.fields[0].status, 'complete');
    assert.equal(report.fields[0].value, 7);
});

test('does not interpret failed or partial candidate reads as bolt values', () => {
    const request = buildRc1CandidateRequests()[0];
    const report = runRc1CollectionProbe({
        reader: () => ({
            status: 'read_complete',
            reads: [
                {
                    key: 'bolts',
                    address: request.address,
                    requestedBytes: 4,
                    bytesRead: 2,
                    success: false,
                    errorCode: 299,
                    bytesBase64: Buffer.from([0, 7, 0, 0]).toString('base64')
                }
            ]
        })
    });

    assert.equal(report.fields[0].status, 'partial');
    assert.equal(Object.hasOwn(report.fields[0], 'value'), false);
    assert.equal(report.fields[0].errorCode, 299);
    assert.equal(report.writesEnabled, false);
});

test('does not decode a full-size buffer from a read marked failed', () => {
    const request = buildRc1CandidateRequests()[0];
    const report = runRc1CollectionProbe({
        reader: () => ({
            status: 'read_complete',
            reads: [{
                key: 'bolts',
                address: request.address,
                requestedBytes: 4,
                bytesRead: 4,
                success: false,
                errorCode: 299,
                bytesBase64: Buffer.from([0, 0, 0, 7]).toString('base64')
            }]
        })
    });

    assert.equal(report.fields[0].status, 'failed');
    assert.equal(Object.hasOwn(report.fields[0], 'value'), false);
    assert.equal(report.fields[0].errorCode, 299);
});

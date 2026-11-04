import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./scripts/collection-bolts.ps1', import.meta.url));
const MAX_UINT32 = 0xFFFFFFFF;

function normalizeProcessId(processId) {
    if (!Number.isSafeInteger(processId) || processId <= 0) {
        throw new RangeError('processId must be a positive safe integer');
    }
    return processId;
}

function formatAddress(address) {
    let value;
    if (typeof address === 'bigint') value = address;
    else if (typeof address === 'number' && Number.isSafeInteger(address)) value = BigInt(address);
    else if (typeof address === 'string' && /^(0x[\da-f]+|\d+)$/i.test(address.trim())) value = BigInt(address.trim());
    else throw new TypeError('address must be an unsigned integer');

    if (value < 0n || value > 0xFFFFFFFFFFFFFFFFn) throw new RangeError('address must fit an unsigned 64-bit integer');
    return `0x${value.toString(16).padStart(16, '0')}`;
}

function invokeCollectionBoltMemory({ mode, processId, address, value, runCommand }) {
    const normalizedPid = normalizeProcessId(processId);
    const normalizedAddress = formatAddress(address);
    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-Mode', mode,
        '-ProcessId', String(normalizedPid),
        '-Address', normalizedAddress
    ];
    if (mode === 'write') {
        if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
            throw new RangeError('value must be an unsigned 32-bit integer');
        }
        args.push('-Value', String(value));
    }

    const result = runCommand('powershell.exe', args, {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024
    });

    if (result.error) throw new Error(`Could not start the Collection memory backend: ${result.error.message}`);
    const output = String(result.stdout || '').trim().replace(/^\uFEFF/, '');
    if (!output) throw new Error(String(result.stderr || `Collection memory backend exited with code ${result.status}`).trim());

    let report;
    try {
        report = JSON.parse(output);
    } catch (error) {
        throw new Error(`Could not parse the Collection memory result: ${error.message}`);
    }

    const expectedStatus = mode === 'read' ? 'read_complete' : 'write_complete';
    if (result.status !== 0 || report.status !== expectedStatus) {
        const error = new Error(report.message || `Collection memory ${mode} failed: ${report.status}`);
        error.report = report;
        throw error;
    }
    const returnedAddress = typeof report.address === 'string' ? report.address.toLowerCase() : '';
    if (report.processId !== normalizedPid || returnedAddress !== normalizedAddress || report.requestedBytes !== 4) {
        throw new Error('Collection memory result does not match the requested process, address, and byte count.');
    }
    if (mode === 'read' && (report.bytesRead !== 4 || !Number.isSafeInteger(report.value) || report.value < 0 || report.value > MAX_UINT32)) {
        throw new Error('Collection memory read did not return one complete 32-bit bolt value.');
    }
    if (mode === 'write' && (report.bytesWritten !== 4 || report.afterValue !== value)) {
        throw new Error('Collection memory write did not verify the requested 32-bit bolt value.');
    }
    return report;
}

export function readCollectionBolts({ processId, address, runCommand = spawnSync } = {}) {
    return invokeCollectionBoltMemory({ mode: 'read', processId, address, runCommand });
}

export function writeCollectionBolts({ processId, address, value, runCommand = spawnSync } = {}) {
    return invokeCollectionBoltMemory({ mode: 'write', processId, address, value, runCommand });
}

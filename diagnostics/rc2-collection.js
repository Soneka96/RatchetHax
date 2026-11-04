import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import rc2Profile from '../games/rc2_ps3_npua80644.js';
import { byteLengthForType, decodeRead, formatAddress } from './rc2-memory.js';

const scriptPath = fileURLToPath(new URL('./rc2-read-process.ps1', import.meta.url));

function addCandidate(requests, profile, key, label, entry) {
    if (!Array.isArray(entry) || entry.length < 2 || entry[0] === null) return;
    const type = String(entry[1]).toLowerCase();
    requests.push({
        key,
        label,
        address: formatAddress(entry[0]),
        dataType: type,
        byteOrder: profile.bigEndian ? 'big' : 'little',
        requestedBytes: byteLengthForType(type),
        verification: 'unverified candidate copied from NPUA80644 profile'
    });
}

export function buildCandidateRequests(profile = rc2Profile) {
    const requests = [];
    addCandidate(requests, profile, 'bolts', 'Bolts', profile.bolts);
    addCandidate(requests, profile, 'health', 'Nanotech / health', profile.nanotech);
    addCandidate(requests, profile, 'raritanium', 'Raritanium', profile.raritanium);
    addCandidate(requests, profile, 'boltMultiplier', 'Bolt multiplier', profile.multiplier);
    addCandidate(requests, profile, 'current.planet', 'Planet ID', profile.current?.planet);
    addCandidate(requests, profile, 'current.item', 'Equipped item ID', profile.current?.item);

    for (const [key, weapon] of Object.entries(profile.weapons || {})) {
        addCandidate(requests, profile, `weapons.${key}.unlocked`, `${weapon.name} unlock flag`, weapon.unlocked);
        addCandidate(requests, profile, `weapons.${key}.ammo`, `${weapon.name} ammo`, weapon.ammo);
    }
    for (const [key, gadget] of Object.entries(profile.gadgets || {})) {
        addCandidate(requests, profile, `gadgets.${key}.unlocked`, `${gadget.name} unlock flag`, gadget.unlocked);
    }
    for (const [key, item] of Object.entries(profile.items || {})) {
        addCandidate(requests, profile, `items.${key}.unlocked`, `${item.name} unlock flag`, item.unlocked);
    }

    return requests;
}

function decodeCandidate(request, rawRead) {
    if (!rawRead) {
        return {
            key: request.key,
            label: request.label,
            address: request.address,
            dataType: request.dataType,
            verification: request.verification,
            status: 'missing_result',
            requestedBytes: request.requestedBytes,
            bytesRead: 0
        };
    }

    const result = {
        key: request.key,
        label: request.label,
        address: request.address,
        dataType: request.dataType,
        byteOrder: request.byteOrder,
        verification: request.verification
    };

    try {
        if (rawRead.address !== request.address) throw new Error('read address does not match the requested candidate');
        if (Number(rawRead.requestedBytes) !== request.requestedBytes) {
            throw new Error('read byte count does not match the requested candidate');
        }
        const decoded = decodeRead({
            success: rawRead.success,
            bytes: Buffer.from(rawRead.bytesBase64 || '', 'base64'),
            bytesRead: Number(rawRead.bytesRead),
            requestedBytes: Number(rawRead.requestedBytes),
            errorCode: Number(rawRead.errorCode)
        }, request.dataType, request.byteOrder);
        Object.assign(result, decoded);
    } catch (error) {
        result.status = 'invalid_result';
        result.error = error.message;
    }

    return result;
}

export function buildProbeReport(rawResult, requests = buildCandidateRequests()) {
    const report = {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        target: 'Ratchet & Clank 2 in the PS3 Collection (BCUS98282)',
        targetBuildStatus: 'unverified',
        sourceProfile: 'rc2_ps3_npua80644',
        sourceProfileStatus: 'unverified candidates only',
        writesEnabled: false,
        status: rawResult.status
    };

    if (rawResult.process) report.process = rawResult.process;
    if (rawResult.processes) report.processes = rawResult.processes;
    if (rawResult.processId !== undefined) report.processId = rawResult.processId;
    if (rawResult.message) report.message = rawResult.message;
    if (rawResult.errorCode !== undefined) report.errorCode = rawResult.errorCode;
    if (rawResult.requestedAccess) report.requestedAccess = rawResult.requestedAccess;

    if (rawResult.status === 'read_complete') {
        const readsByKey = new Map((rawResult.reads || []).map(read => [read.key, read]));
        report.fields = requests.map(request => decodeCandidate(request, readsByKey.get(request.key)));
    }

    return report;
}

export function invokePowerShellReader({ processId, requests, runCommand = spawnSync }) {
    const args = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath
    ];
    if (processId !== undefined) args.push('-ProcessId', String(processId));
    const requestsJsonLines = requests
        .map(({ key, address, requestedBytes }) => JSON.stringify({ key, address, requestedBytes }))
        .join('\n');
    args.push('-RequestsBase64', Buffer.from(requestsJsonLines, 'utf8').toString('base64'));

    const result = runCommand('powershell.exe', args, {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
    });

    if (result.error) return { status: 'backend_unavailable', message: result.error.message };

    try {
        const output = result.stdout.trim().replace(/^\uFEFF/, '');
        if (!output) return { status: 'backend_error', message: result.stderr.trim() || `PowerShell exited with code ${result.status}` };
        return JSON.parse(output);
    } catch (error) {
        return {
            status: 'backend_error',
            message: `Could not parse the PowerShell result: ${error.message}`,
            details: result.stderr.trim()
        };
    }
}

export function runCollectionProbe({ processId, reader = invokePowerShellReader, profile = rc2Profile } = {}) {
    const requests = buildCandidateRequests(profile);
    const rawResult = reader({ processId, requests });
    return buildProbeReport(rawResult, requests);
}

export function parseProbeArguments(args) {
    const parsed = {};
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--pid') {
            const value = args[index + 1];
            if (!/^\d+$/.test(value || '') || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
                throw new Error('--pid requires a positive process ID');
            }
            parsed.processId = Number(value);
            index += 1;
        } else if (args[index] === '--help' || args[index] === '-h') {
            parsed.help = true;
        } else if (args[index] === '--out') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error('--out requires a file path');
            parsed.outputPath = value;
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${args[index]}`);
        }
    }
    return parsed;
}

function printHelp() {
    return [
        'Read-only RC2 Collection candidate probe',
        '',
        'Usage: node diagnostics/rc2-collection.js [--pid <RPCS3 PID>] [--out <JSON path>]',
        '',
        'If exactly one rpcs3.exe process is running, it is selected automatically.',
        'If several are running, rerun with --pid. All NPUA80644 fields are unverified candidates.',
        'Use --out to write UTF-8 JSON without shell redirection.'
    ].join('\n');
}

function isDirectExecution() {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
    try {
        const options = parseProbeArguments(process.argv.slice(2));
        if (options.help) {
            process.stdout.write(`${printHelp()}\n`);
        } else {
            const report = runCollectionProbe(options);
            const output = `${JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)}\n`;
            if (options.outputPath) {
                writeFileSync(path.resolve(options.outputPath), output, { encoding: 'utf8', flag: 'wx' });
                process.stdout.write(`Wrote JSON observation to ${path.resolve(options.outputPath)}\n`);
            } else {
                process.stdout.write(output);
            }
        }
    } catch (error) {
        process.stderr.write(`${error.message}\n${printHelp()}\n`);
        process.exitCode = 2;
    }
}

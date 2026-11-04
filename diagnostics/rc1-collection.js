import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import rc1Profile from '../games/rc1_ps3_npua80643.js';
import {
    buildCandidateRequests,
    buildProbeReport,
    invokePowerShellReader,
    parseProbeArguments
} from './rc2-collection.js';

const target = 'Ratchet & Clank 1 in the PS3 Collection (BCUS98282)';
const sourceProfile = 'rc1_ps3_npua80643';
const boltCandidateProfile = {
    bigEndian: rc1Profile.bigEndian,
    bolts: rc1Profile.bolts
};

export function buildRc1CandidateRequests() {
    return buildCandidateRequests(boltCandidateProfile, { sourceProfile: 'NPUA80643' });
}

export function runRc1CollectionProbe({ processId, reader = invokePowerShellReader } = {}) {
    const requests = buildRc1CandidateRequests();
    const rawResult = reader({ processId, requests });
    return buildProbeReport(rawResult, requests, { target, sourceProfile });
}

function printHelp() {
    return [
        'Read-only RC1 Collection bolt candidate probe',
        '',
        'Usage: node diagnostics/rc1-collection.js [--pid <RPCS3 PID>] [--out <JSON path>]',
        '',
        'The standalone NPUA80643 bolt address is an unverified candidate only.',
        'The probe reads only that candidate and never writes process memory.',
        'If several RPCS3 processes are running, specify --pid.'
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
            const report = runRc1CollectionProbe(options);
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

/**
 * Read-only RC2 PS3 address probe for the Ratchet & Clank Collection (BCUS98282).
 *
 * WARNING: The existing NPUA80644 offsets are CANDIDATES, not verified
 * BCUS98282 offsets. This tool never calls writeMemory or writeBuffer.
 *
 * Usage:
 *   node scripts/probe-rc2-bcus98282.js <RPCS3-PID>
 *
 * Keep a backup save. Run while actually inside RC2 gameplay (not the
 * Collection selector, loading screen, or the RPCS3 game list).
 */
import memoryjs from 'memoryjs';
import candidate from '../games/rc2_ps3_npua80644.js';

const pidText = process.argv[2];
const pid = Number(pidText);
if (!pidText || !Number.isSafeInteger(pid) || pid <= 0) {
    console.error('Usage: node scripts/probe-rc2-bcus98282.js <RPCS3-PID>');
    process.exitCode = 2;
} else {
    const checks = [
        ['bolts', candidate.bolts],
        ['nanotech', candidate.nanotech],
        ['raritanium', candidate.raritanium],
        ['multiplier', candidate.multiplier],
        ['current planet ID', candidate.current.planet],
        ['equipped item ID', candidate.current.item],
        ['Lancer unlocked', candidate.weapons.lancer.unlocked],
        ['Lancer ammo', candidate.weapons.lancer.ammo],
        ['Swingshot unlocked', candidate.gadgets.swingshot.unlocked]
    ];

    console.log('BCUS98282 / Ratchet & Clank 2 — READ-ONLY diagnostic');
    console.log('Source: NPUA80644 addresses; not validated for BCUS98282.');
    console.log('No game-memory write operations are performed.\n');
    console.log('Do not interpret nonzero unlock flags as proof of correct offsets.');
    console.log('Values alone do not establish address correctness.\n');

    let processHandle;
    try {
        const info = memoryjs.getProcesses().find(p => p.th32ProcessID === pid);
        if (!info || info.szExeFile.toLowerCase() !== 'rpcs3.exe') {
            throw new Error('The selected PID is not a running rpcs3.exe process.');
        }
        processHandle = memoryjs.openProcess(pid).handle;
        for (const [label, descriptor] of checks) {
            if (!descriptor || descriptor[0] == null) {
                console.log(`${label}: not defined`);
                continue;
            }
            const [address, type] = descriptor;
            const resolvedType = `${type.toUpperCase()}_BE`;
            const memoryType = memoryjs[resolvedType];
            if (memoryType == null) {
                console.log(`${label}: unsupported data type ${resolvedType}`);
                continue;
            }
            try {
                const value = memoryjs.readMemory(processHandle, address, memoryType);
                console.log(`${label.padEnd(20)} 0x${address.toString(16).toUpperCase()}: ${value}`);
            } catch (error) {
                console.log(`${label.padEnd(20)} 0x${address.toString(16).toUpperCase()}: READ FAILED (${error.message})`);
            }
        }
        console.log('\nCompare these readings against the values visible in-game.');
        console.log('The native memoryjs build reported pointer-truncation warnings.');
        console.log('If readings are implausible, STOP: do not use the original trainer to write memory.');
    } catch (error) {
        console.error('Probe failed:', error.message);
        process.exitCode = 1;
    } finally {
        if (processHandle != null && typeof memoryjs.closeProcess === 'function') {
            try { memoryjs.closeProcess(processHandle); } catch { /* best effort */ }
        }
    }
}

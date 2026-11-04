# Ratchet & Clank Collection (BCUS98282): RC2 compatibility investigation

## Current status

**Experimental / read-only investigation only.** The existing `games/rc2_ps3_npua80644.js` profile is for standalone Ratchet & Clank 2 (NPUA80644). It has **not** been validated for the disc Collection (BCUS98282). Selecting the NPUA80644 profile in the regular trainer can show bogus values (zero bolts, unknown planet, 100% unlocks). This is **not** proof that the Collection uses entirely different addresses: 64-bit native pointer handling, emulator memory layout, and game state are also potential causes.

Never use the trainer's write actions with BCUS98282 until the address mappings and native memory access have been verified. Back up the RPCS3 save before experimenting.

## Step 1: Collect read-only measurements (preferred Windows probe)

With RC2 **actively loaded in-game** (not the Collection menu), note your visible bolt count, health and current planet.

Use PowerShell in the fork's repository root (or fetch the `scripts/probe-rc2-bcus98282.ps1` script from the branch). No npm installation or native addon build is needed for this probe:

```powershell
cd "C:\Project\RatchetHax"
Get-Process rpcs3 | Select-Object Id, ProcessName
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\probe-rc2-bcus98282.ps1" -ProcessId <ACTUAL_PID>
```

Replace `<ACTUAL_PID>` with the numeric process ID (omit angle brackets). This probe requests only `PROCESS_VM_READ` and limited query permissions, calls Windows `ReadProcessMemory` directly and verifies that **all requested bytes were read**. Unlike the npm `memoryjs` probe, it reports explicit Windows errors for failed reads and interprets 32-bit game values as big-endian.

If this repo is just an older zip copy, download the new script from the fork's development branch before running it.

The original `scripts/probe-rc2-bcus98282.js` is retained for comparison only; it uses the native memoryjs module whose `readMemory` returns values without validating whether the Windows read actually succeeded. **Prefer the PowerShell probe** to distinguish unmapped memory from incorrect or stale game values.

Compare results with actual in-game data. A successful read does not mean the address belongs to RC2: confirm at least two different legitimate bolt counts after ordinary gameplay changes before considering an address verified. Do not enable trainer writes.

## Next steps (not yet implemented)

1. Confirm actual RC2 game/build identity inside BCUS98282 and ensure RPCS3 game is active.
2. Review 64-bit `memoryjs` addressing and assess a safer native backend if needed.
3. Derive and validate BCUS98282-specific addresses by matching multiple live observations, not by replacing the serial in a copied file.
4. Create `games/rc2_ps3_bcus98282.js` only with validated fields; unsupported ones should remain absent or null.
5. Add an explicit game/build validation gate before enabling write operations.
6. Test each write with save backups and documented rollback, then add regression tests.

No BCUS98282 compatibility claim is made by this initial diagnostic.

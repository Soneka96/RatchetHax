# Ratchet & Clank Collection (BCUS98282): RC2 compatibility investigation

## Current status

**Experimental / read-only investigation only.** The existing `games/rc2_ps3_npua80644.js` profile is for standalone Ratchet & Clank 2 (NPUA80644). It has **not** been validated for the disc Collection (BCUS98282). Selecting the NPUA80644 profile in the regular trainer can show bogus values (zero bolts, unknown planet, 100% unlocks). This is **not** proof that the Collection uses entirely different addresses: 64-bit native pointer handling, emulator memory layout, and game state are also potential causes.

Never use the trainer's write actions with BCUS98282 until the address mappings and native memory access have been verified. Back up the RPCS3 save before experimenting.

## Step 1: Collect read-only measurements

With RC2 *actively loaded in-game* (not the Collection menu), note the on-screen bolt count and planet. Open a PowerShell terminal in the fork's project root, then:

```powershell
npm install --ignore-scripts
# Build memoryjs separately if necessary, as described in the upstream setup.
# Find RPCS3's actual PID using Task Manager or:
Get-Process rpcs3 | Select-Object Id, ProcessName

node scripts/probe-rc2-bcus98282.js <PID>
```

Replace `<PID>` with the numeric PID (without angle brackets). This script probes a small, fixed set of **NPUA80644 candidate** addresses using explicit big-endian reads. It does not call any memory-writing APIs. Do not treat the readings as valid just because a number appears.

Record the actual in-game value and the corresponding diagnostic value for **bolts, health/Nanotech and planet**. Ideally repeat with *two distinct known bolt counts* after ordinary gameplay changes, while still not writing through the trainer. These comparisons will help establish whether an offset is correct.

**Technical caveat:** The original `memoryjs@3.5.1` build emitted native C++ pointer-truncation warnings on x64. The emulator memory addresses used here exceed 32 bits (for example, `0x301329A90`). Before trusting any memory results or introducing writes, verify whether the native addon preserves full 64-bit addresses correctly. A successful build and an open RPCS3 process do not prove correct memory access. If the probe fails or native code crashes, stop and share the result instead of repeatedly running it.

## Next steps (not yet implemented)

1. Confirm actual RC2 game/build identity inside BCUS98282 and ensure RPCS3 game is active.
2. Review 64-bit `memoryjs` addressing and assess a safer native backend if needed.
3. Derive and validate BCUS98282-specific addresses by matching multiple live observations, not by replacing the serial in a copied file.
4. Create `games/rc2_ps3_bcus98282.js` only with validated fields; unsupported ones should remain absent or null.
5. Add an explicit game/build validation gate before enabling write operations.
6. Test each write with save backups and documented rollback, then add regression tests.

No BCUS98282 compatibility claim is made by this initial diagnostic.

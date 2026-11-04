# RC2 Collection read-only diagnostics runbook

This probe gathers repeatable memory-read observations for Ratchet & Clank 2
running in the PS3 Collection (`BCUS98282`) under RPCS3. It uses only the
existing `NPUA80644` profile values as **unverified candidates**. The report
does not identify the loaded game build, certify an address, or enable writes.

## What the probe does

- Finds running `rpcs3.exe` processes. It selects the only match automatically;
  if there are several, it prints their process IDs and asks for `--pid` on the
  next invocation.
- Opens the selected process with `PROCESS_VM_READ` only.
- Reads each candidate through Windows `ReadProcessMemory`, recording its
  success flag, requested and returned byte counts, and Windows error code.
- Decodes a value only after the read succeeds and returns the full requested
  byte count. Values use the type and byte order declared by the source profile.
- Emits JSON containing the process identity, exact candidate address, status,
  decoded value when valid, and a clear unverified label. Fields include bolts,
  nanotech/health, planet and equipped-item IDs, raritanium, multiplier, weapon
  ammo and unlock flags, gadget unlock flags, and item unlock flags.

The probe reads the absolute addresses already listed in the standalone profile;
it does not calculate a host address by adding `0x300000000`. RPCS3 may reserve
its memory at a different base. `targetBuildStatus` remains `unverified` in every
report, and successful attachment or a plausible value is not proof of support.

## Collect two observations

Use 64-bit Windows PowerShell and Node.js from the repository root. The current
Windows setup notes document Node.js 18.20.8 for this checkout.

1. Start RPCS3 and load RC2 from the Collection. In active gameplay, note the
   RPCS3 version, the game title/build shown by RPCS3, the visible bolt count,
   and the planet. Keep a short observation note with the output file.
2. If more than one RPCS3 process is running, list them and choose the PID for
   the emulator instance running the game:

   ```powershell
   Get-Process rpcs3 | Select-Object Id, Path
   ```

3. Capture the first JSON observation. With one RPCS3 process, omit `--pid`:

   ```powershell
   node .\diagnostics\rc2-collection.js --out .\rc2-collection-observation-1.json
   ```

   `--out` creates a new file and refuses to overwrite an existing observation.

   With multiple instances, pass the selected PID:

   ```powershell
   node .\diagnostics\rc2-collection.js --pid 1234 --out .\rc2-collection-observation-1.json
   ```

4. Pick up or spend bolts through normal gameplay. Note the new visible count
   and planet, then capture a second observation using the same process:

   ```powershell
   node .\diagnostics\rc2-collection.js --pid 1234 --out .\rc2-collection-observation-2.json
   ```

5. Send both JSON files and the two observation notes together. Include the
   RPCS3 version and the Collection/game identity shown in RPCS3. Do not edit
   either JSON file before sharing it; if you redact anything, say what changed.

If the probe reports `no_rpcs3_process`, `selection_required`,
`process_not_found`, `open_failed`, `failed`, or `partial`, preserve the output
and its error code. Do not treat those results as game values. For comparisons,
use only fields whose status is `complete`, and compare the bolt value to the
visible count in both observations.

## Automated checks

From the repository root, run the JavaScript unit tests and the PowerShell
Pester tests:

```powershell
node --test test/diagnostics/rc2-memory.test.js test/diagnostics/rc2-collection.test.js
Invoke-Pester -Script .\test\diagnostics\rc2-read-process.Tests.ps1
```

The JavaScript tests use mocked process/read responses. The PowerShell tests
mock process selection and Win32 calls; they do not attach to RPCS3.

## Acceptance criteria

The diagnostics can be considered reliable for further address investigation
when all of the following hold:

1. Process selection identifies the intended `rpcs3.exe` PID; multiple running
   instances require an explicit PID.
2. The opened handle requests `PROCESS_VM_READ` only. The probe contains no
   process-memory write path.
3. Every result preserves the exact source address and includes read success,
   requested/returned byte counts, and the Windows error code on failure.
4. Failed, short, missing, or inconsistent read results never produce decoded
   values; a complete read of zero is reported as the valid number zero.
5. The two gameplay observations show complete bolt reads that match the visible
   bolt count and change consistently after the legitimate in-game change.
6. RPCS3 version, loaded game identity, visible counts, and raw JSON outputs are
   retained together so another person can reproduce the comparison.

Meeting these criteria validates the diagnostic method and the bolt candidate
for those recorded observations only. It does not verify health, planet,
equipped-item, weapon, or unlock addresses, and it does not establish general
`BCUS98282` support. Each field needs its own independent gameplay correlation.
No `BCUS98282` profile should be populated and no game-memory writes should be
enabled based on this probe alone.

# RC2 Collection read-only snapshot and diff runbook

Use this workflow to compare live RC2 Collection memory with HUD observations.
The snapshot reader and diff scanner do not write process memory. The only
address profile currently validated for this Collection session is the bolt
field documented in the [investigation report](rc2-collection-investigation.md).

## Bolt-only trainer profile

In the trainer, select **Ratchet & Clank 2: Going Commando [Collection
BCUS98282] - Bolts only**. This profile uses the confirmed host address
`0x301329E80` (guest address `0x01329E80`) and offers only bolt display, refresh,
Set Bolts, and Quit. The other Collection fields remain absent and unsupported.

This static host address was validated with RPCS3's `g_base_addr` at
`0x300000000`. Before using the profile in another RPCS3 session or build,
check its `RPCS3.log` guest-memory base; stop if the base differs.

## Capture a snapshot

Use 64-bit Windows PowerShell from the repository root. Confirm RC2 is loaded
inside the Collection, then record the visible bolt count. If multiple RPCS3
processes are running, use the PID for the one running the Collection:

```powershell
Get-Process rpcs3 | Select-Object Id, Path
$rpcs3Pid = 15324 # Replace with the selected PID.
```

For the tested RPCS3 build, the log showed guest base `0x300000000` and the
active RC2 PPU data segment at guest start `0x012E0000`, length `13580688`
bytes. Recheck `RPCS3.log` after a build or game change; pass the logged values
for that session. The snapshot command requests `PROCESS_VM_READ` only, reads in
chunks, checks every success flag and byte count, then creates a `.bin` snapshot
and `.meta.json` sidecar. It refuses to overwrite either file.

```powershell
$before = Join-Path $env:TEMP 'RatchetHax-RC2-before.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase 0x300000000 -GuestStart 0x012E0000 -SnapshotLength 13580688 `
  -ChunkSize 65536 -SnapshotPath $before -HudBolts 244012
```

Use the exact HUD count you observed instead of `244012`. Choose a new filename
for every capture.

Collect or spend bolts through ordinary gameplay, record the new HUD count, and
capture the second snapshot to a different path:

```powershell
$after = Join-Path $env:TEMP 'RatchetHax-RC2-after.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase 0x300000000 -GuestStart 0x012E0000 -SnapshotLength 13580688 `
  -ChunkSize 65536 -SnapshotPath $after -HudBolts 244016
```

## Scan for the changing value

When both snapshots have metadata sidecars, the scanner reads their guest range
and HUD values from those files:

```powershell
node .\diagnostics\rc2-memory-diff.js --before $before --after $after
```

For older raw snapshots without sidecars, pass the metadata explicitly:

```powershell
node .\diagnostics\rc2-memory-diff.js `
  --before (Join-Path $env:TEMP 'RatchetHax-RC2-BCUS98282-244012.bin') `
  --after (Join-Path $env:TEMP 'RatchetHax-RC2-BCUS98282-244016.bin') `
  --guest-base 0x300000000 --guest-start 0x012E0000 `
  --before-hud 244012 --after-hud 244016
```

The scanner reports every aligned big-endian 32-bit location that held the
first HUD value in the before snapshot and the second in the after snapshot. A
match is a candidate; if several locations match, repeat with a different HUD
change and observe whether the same location tracks it. Do not treat a readable
address, a mirror, or a plausible value as proof by itself.

The saved `244012 → 244016` comparison produced guest candidates `0x01329E80`
and `0x0157E080`. Subsequent testing showed the first address at host
`0x301329E80` drove the visible bolt value; the second followed it as a mirror.
The old NPUA80644 bolt address `0x301329A90` remained zero. A user-authorized
test write of +1,000 to the first candidate was confirmed by the HUD. These
findings apply to the tested RC2 Collection session; do not infer that other
standalone-profile fields are valid.

## Automated checks

```powershell
node --test test/diagnostics/rc2-memory.test.js test/diagnostics/rc2-collection.test.js test/diagnostics/rc2-memory-diff.test.js
Invoke-Pester -Script .\test\diagnostics\rc2-read-process.Tests.ps1
```

The automated tests use mocked process/read results and temporary snapshot
files. They do not attach to RPCS3 or write game memory. The capture and diff
tools are read-only. The trainer's bolt-only Set Bolts action uses the one
validated field; do not add health, planet, equipped-item, weapon, or unlock
fields until they are independently validated.

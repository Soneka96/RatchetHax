# RC1 Collection read-only memory capture runbook

Use this procedure to compare Ratchet & Clank 1's visible bolt count with
RPCS3 guest memory. The candidate probe and snapshot/diff tools are read-only.
The standalone RC1 bolt address `0x3009B9CE0` is only a candidate; a readable
value does not prove it is the live bolt field.

## Identify the active session

1. Confirm in RPCS3 that the Collection is running **Ratchet & Clank 1 in
   normal gameplay**, and note the visible HUD bolt count. The outer title ID
   `BCUS98282` alone does not identify the active subgame.
2. Record the RPCS3 version, process ID and executable path. If several RPCS3
   processes are open, use the PID for the process running the game.
3. From the session's `RPCS3.log`, record the active PPU executable and any
   internal app/SKU or build identity, `vm::g_base_addr`, and the active PPU
   memory segment start and length. Do not reuse RC2's base or segment values.
   If RPCS3 locks the log during play, capture the memory observations first,
   then inspect the log when it is readable and associate it with that exact
   session before drawing conclusions.

## Read the old candidate

From the repository root, run the probe with the selected PID:

```powershell
node .\diagnostics\rc1-collection.js --pid 15324
```

Replace `15324` with the selected PID. The report should show the exact
requested address, `int32` type, big-endian byte order, success flag, and
complete byte count. Failed or partial reads have no decoded value. Record the
HUD count observed at the same time; without that pairing, a value is not
evidence for or against the candidate.

## Capture two normal gameplay counts

Use 64-bit Windows PowerShell. Select the game process and enter the values
only from this active RC1 session and its RPCS3 log. `GuestStart` and
`SnapshotLength` must stay within the logged active RC1 PPU segment. A snapshot
can be at most 64 MiB; if the segment is larger, capture contiguous subranges
of at most 64 MiB and run the comparison separately for each matching range.
Use the same start and length for both counts and again after the restart.

```powershell
Get-Process -Name rpcs3 | Select-Object Id, Path
$rpcs3Pid = [int](Read-Host 'Enter the PID running Collection Game 1')
$guestBase = Read-Host 'Enter this session g_base_addr from RPCS3.log'
$guestStart = Read-Host 'Enter the active RC1 PPU segment start from RPCS3.log'
$segmentLength = [int](Read-Host 'Enter that segment length in bytes')
$beforeHud = [int](Read-Host 'Enter the exact visible HUD bolt count')
```

Choose a new output name for every capture. Snapshot output files contain raw
game memory; keep them local unless you deliberately choose to share them.
Before each capture, let the HUD settle at the observed count and keep gameplay
still until the snapshot completes. The reader requests `PROCESS_VM_READ`,
checks every read result and byte count, and refuses to save an incomplete
snapshot or overwrite an existing file. The reader checks guest address-space
bounds, but it does not check the supplied range against RPCS3's logged PPU
segment; ensure that range belongs to the active RC1 segment yourself.

```powershell
$before = Join-Path $env:TEMP 'RatchetHax-RC1-before.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase $guestBase -GuestStart $guestStart -SnapshotLength $segmentLength `
  -ChunkSize 65536 -SnapshotPath $before -HudBolts $beforeHud
```

Gain or spend bolts through ordinary gameplay, record the new HUD count, and
capture the same segment to a different file:

```powershell
$afterHud = [int](Read-Host 'Enter the new exact visible HUD bolt count')
$after = Join-Path $env:TEMP 'RatchetHax-RC1-after.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase $guestBase -GuestStart $guestStart -SnapshotLength $segmentLength `
  -ChunkSize 65536 -SnapshotPath $after -HudBolts $afterHud
```

Compare the captures offline:

```powershell
node .\diagnostics\rc2-memory-diff.js --before $before --after $after
```

The scanner finds aligned big-endian 32-bit locations containing the two HUD
values. A match is only a candidate. Repeat with another normal HUD change to
separate stable values from mirrors, caches, and unrelated matches. Validate
the candidate's full 4-byte read, signed or unsigned interpretation, byte
order, and exact address against each observation. Keep the legacy
`int32` candidate's sign separate from the scanner's `uint32` search result;
positive values share the same four bytes, but type still needs independent
validation.

## Repeat after restarting RPCS3

Restart RPCS3, launch Collection Game 1 again, re-identify its active PPU
executable/build and memory base/segment, and repeat at least one distinct HUD
bolt transition with fresh snapshot filenames. A candidate is not reliable if
its address or value relationship cannot be reproduced in this second session.

## Safety boundary and checks

These tools do not write game memory. Do not add an RC1 Collection trainer
profile or enable Set Bolts until the candidate is supported by at least two
different normal HUD counts and reproduced after restart. A targeted write
test on a backed-up save is a separate experiment and requires explicit user
approval. If no reliable address is found, stop at documented read-only
research.

The mocked automated reader/snapshot checks are:

```powershell
node --test test/diagnostics/rc1-collection.test.js test/diagnostics/rc2-collection.test.js test/diagnostics/rc2-memory.test.js test/diagnostics/rc2-memory-diff.test.js
Invoke-Pester -Script .\test\diagnostics\rc2-read-process.Tests.ps1
```

They do not attach to RPCS3 and do not establish address validity.

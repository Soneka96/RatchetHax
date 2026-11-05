# RC3 Collection read-only snapshot and diff runbook

Use this workflow to compare Ratchet & Clank 3's visible bolt count with live
RPCS3 guest memory. The candidate probe, snapshot reader, and differential
scanner are read-only. The standalone RC3 candidate `0x300C1E4DC` did not match
the observed Collection count.

## Identify the session and mapped range

1. Confirm normal RC3 Collection gameplay and note the exact HUD bolt count.
   The outer title ID `BCUS98282` alone does not identify the embedded game.
2. Record the RPCS3 version, PID, executable path, active game/SKU identity,
   `g_base_addr`, and active RC3 PPU segment from that session's logs.
3. If the log does not expose a PPU segment, use a read-only process-map query
   and clearly label the result as process-map evidence, not an ELF segment.
   Do not reuse RC1 or RC2 segment ranges without rechecking the RC3 session.

For the observed session, RPCS3 TTY showed save namespace
`NPUA80645_RC3_SAVEDATA_A`. `VirtualQueryEx` observed host reservation
`0x300000000` and a committed mapped range at guest start `0x00BD0000`, length
`0x00F10000`. The standalone bolt candidate read zero while the user reported
753 bolts.

## Capture two gameplay counts

Use 64-bit Windows PowerShell and the exact process ID, base, and mapped range
from the active RC3 session. The snapshot reader accepts up to 64 MiB per
capture, requests `PROCESS_VM_READ`, checks every success flag and byte count,
and refuses incomplete reads or overwriting files. The supplied range must be
inside the observed RC3 mapping; the script does not verify the PPU segment.

```powershell
Get-Process -Name rpcs3 | Select-Object Id, Path
$rpcs3Pid = [int](Read-Host 'Enter the PID running Collection RC3')
$guestBase = Read-Host 'Enter this session host guest base from RPCS3.log'
$guestStart = Read-Host 'Enter the RC3 mapped guest start'
$snapshotLength = [int](Read-Host 'Enter the mapped range length in bytes')
$beforeHud = [int](Read-Host 'Enter the exact visible HUD bolt count')
$before = Join-Path $env:TEMP 'RatchetHax-RC3-before.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase $guestBase -GuestStart $guestStart -SnapshotLength $snapshotLength `
  -ChunkSize 65536 -SnapshotPath $before -HudBolts $beforeHud
```

Change bolts through normal gameplay, record the new exact HUD count, and
capture the same mapped range to a new file. Keep the count stable while each
snapshot is read:

```powershell
$afterHud = [int](Read-Host 'Enter the new exact visible HUD bolt count')
$after = Join-Path $env:TEMP 'RatchetHax-RC3-after.bin'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\diagnostics\rc2-read-process.ps1 `
  -Snapshot -ProcessId $rpcs3Pid `
  -GuestBase $guestBase -GuestStart $guestStart -SnapshotLength $snapshotLength `
  -ChunkSize 65536 -SnapshotPath $after -HudBolts $afterHud
node .\diagnostics\rc2-memory-diff.js --before $before --after $after
```

A matching address is only a candidate. Repeat with another normal bolt change
to distinguish mirrors/caches and reproduce the candidate after restarting
RPCS3. A targeted memory write is a separate experiment and requires explicit
user authorization before it is run.

## Trainer behavior and checks

The RC3 Collection trainer exposes bolts only and shares the RC1/RC2
in-process `Game.bolts` path. Set Bolts verifies the requested value by
read-back. Bolt-only Quit returns to the game-version list while retaining the
selected emulator process. The user chose explicit profile selection with one
embedded Collection game open; no automatic subgame guard is implemented, so
select the RC3 profile only while RC3 is active.

```powershell
node --test
Invoke-Pester -Script .\test\diagnostics\rc2-read-process.Tests.ps1
```

These tests use mocks and do not establish live address validity. The known
candidate and findings for the tested session are in the [RC3 investigation](rc3-collection-investigation.md).

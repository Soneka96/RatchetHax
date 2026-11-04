# Ratchet & Clank 1 in the PS3 Collection (BCUS98282): investigation status

## Scope and safety

This investigation covers only bolt reading and, if separately validated,
bolt setting for Ratchet & Clank 1 inside the PS3 Collection. The standalone
RC1 address in `games/rc1_ps3_npua80643.js` is an unverified candidate. The new
`diagnostics/rc1-collection.js` probe reads that candidate only and requests
`PROCESS_VM_READ`; it never writes process memory. The Collection RC1 trainer
profile contains only the tested bolt field, and Set Bolts uses the separate
checked Win32 backend documented below. No other game actions are exposed.

## Observed session

On 2026-11-04, the RPCS3 game window displayed the outer title
`Ratchet & Clank Collection [BCUS98282]`. The RPCS3 main window and its log
pane identified build `0.0.43-20561-b2e52d63 Alpha | master`, x64 architecture,
and firmware `4.93`. The emulator process was PID `15324` at
`C:\Games\Emulator\PS3\rpcs3.exe` when observed. The game window title and
outer title ID do not identify which embedded game was active.

The `RPCS3.log` file was present at
`C:\Games\Emulator\PS3\rpcs3\log\RPCS3.log` (22,921,626 bytes, last modified
2026-11-04 18:46:45 local time), but the running emulator held it with sharing
that prevented direct file reads. The RPCS3 GUI log pane showed general
startup details, including current time `2026-11-04T08:42:48`, but no active
PPU load or guest-memory lines. Therefore the session's active PPU executable,
internal game identity, `g_base_addr`, PPU build identifiers, and memory
segment ranges were not established.

The read-only probe was run against PID `15324`. The attached gameplay capture
showed 5,155 bolts at 19:11:15; 36 seconds later the probe returned
`read_complete` for the old standalone candidate, host address `0x3009B9CE0`,
with a complete 4-byte big-endian `int32` value of `0`. This rejects that old
address for the observed 5,155-bolt state.

| Evidence | Observation | Status |
| --- | --- | --- |
| RPCS3 build | `0.0.43-20561-b2e52d63 Alpha | master` | Observed in window and GUI log |
| RPCS3 architecture / firmware | x64 / `4.93` | Observed in GUI log |
| Outer Collection title | `BCUS98282` | Observed in game window title |
| Active subgame / PPU executable | PPU executable/build not established; RPCS3 TTY showed save namespace `NPUA80643_RC1_SAVEDATA_A` | Confirms RC1 save identity, not the loaded PPU executable |
| RPCS3 guest-memory mapping | Reservation at host `0x300000000`; committed range at guest `0x00750000`, length `0x00F10000` | Read-only `VirtualQueryEx`; not yet matched to a PPU segment log |
| Old standalone RC1 bolt candidate | `0x3009B9CE0`, big-endian `int32`, value `0` while HUD showed `5,155` | Rejected for this observed state |
| HUD counts and snapshots | `5,155 → 5,105 → 5,055` | Two complete transitions captured in the same mapped range |
| Differential candidates | `0x300774BA4` and `0x3009BC3A0`, big-endian 32-bit | Both matched both observed transitions; read/write behavior below distinguishes them |
| Restart reproduction | Not performed | Requires a second RPCS3 session |
| Visible HUD after write validation | User confirmed it showed `105,055` after the targeted write | Later gameplay spending changed the count |

## Differential scan and targeted write validation

`VirtualQueryEx` on RPCS3 PID `15324` showed a guest-memory reservation
beginning at host `0x300000000`. The committed mapped range used for scanning
began at host `0x300750000` (guest `0x00750000`) and was `0x00F10000` bytes
long. This is process-map evidence; the locked RPCS3 log did not establish
that it is the active PPU executable's complete data segment.

Read-only snapshots of this same range tracked normal gameplay HUD changes
from 5,155 to 5,105 and then 5,055. Both offline scans found exactly two
aligned big-endian 32-bit locations:

| Role | Guest address | Host address | HUD transitions |
| --- | ---: | ---: | --- |
| Candidate A | `0x00774BA4` | `0x300774BA4` | `5,155 → 5,105 → 5,055` |
| Candidate B | `0x009BC3A0` | `0x3009BC3A0` | `5,155 → 5,105 → 5,055` |

Complete reads returned `5,105` (`00 00 13 F1`) at both candidates, then
`5,055` (`00 00 13 BF`) at both. After the user explicitly authorized a
targeted test on the test save, Candidate A was written to `15,055` (+10,000).
The full read-back initially matched, but after 500 ms the game had restored
both fields to `5,055`. Candidate B was then written to `105,055` (+100,000).
Its full read-back matched; after 500 ms both Candidate A and Candidate B read
`105,055`. This behavior identifies Candidate B as the authoritative field
and Candidate A as a mirror/cache for the tested session. The user confirmed
the in-game HUD showed `105,055` after the targeted write. No save file was
written directly. After the user spent more bolts through normal gameplay, a
later complete read returned `99,453` at both candidates; this later count was
not paired with a fresh HUD capture.

Snapshot files were kept in the local temporary directory. Their capture
metadata and checksums are in the adjacent `.meta.json` sidecars.

## Memory backend and trainer result

RC1 and RC2 now use the same in-process `Game.bolts` / `memoryjs@3.5.1` path.
The tested x64 addon preserved the full host address when reading
`0x3009BC3A0`. Its native calls do not expose the Win32 success flag or
transferred-byte count; the shared Set Bolts action checks the value by reading
it back. Failed reads can still be ambiguous under this API. `Game` now resets
the shared memoryjs data-type constants for every selected profile so a
Collection big-endian profile does not leak into a later PS2 selection.

An intermediate RC1-only PowerShell reader/writer caused the reported
one-to-two-second menu delay because it started a new process per access. That
path has been removed; RC1 now reads and writes through the same in-process path
as RC2. The bolt-only Quit action now closes the selected game handle and
returns to the game-version list, retaining the selected emulator process.

The first RC1 trainer launch failed because that intermediate PowerShell
backend returned uppercase hex while its JS wrapper compared lowercase. The
case comparison was fixed before the backend was removed.

After the shared-path and selection changes, `node --test` passed (61 tests)
and the RPCS3 read/snapshot Pester suite passed (19 tests). The checked
Win32 backend also completed a live read of `99,453` at `0x3009BC3A0` before it
was removed during this consolidation.

Candidate B is confirmed for the tested session by two normal HUD transitions,
the targeted write/read-back behavior, and the user's HUD confirmation. It is
enabled in the RC1 bolt-only trainer profile at the user's direction. The
profile shares the RC2 bolt-only memory access and menu implementation.

The user chose a one-embedded-game-at-a-time workflow with explicit profile
selection instead of a runtime subgame guard. The Collection's outer title ID
is shared, so the trainer does not independently prevent selecting the RC1
profile while RC2 is active. Select the RC1 profile only while Collection Game
1 is running. Restart reproduction and the active PPU executable/build remain
unverified; the confirmed address is limited to the tested session.

## Remaining verification

The bolt field and targeted write are verified for this session. Restart
reproduction, the active PPU executable/build identity, and a PPU-log-confirmed
segment range remain unverified. The user chose explicit profile selection
with one Collection game open at a time instead of an automatic runtime
subgame guard. Because the two games share outer title ID `BCUS98282`, the
trainer cannot prevent a user from selecting the RC1 profile while RC2 is
active. Keep PR #1 in draft and do not merge until the remaining verification
and review are complete.

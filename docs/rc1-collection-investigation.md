# Ratchet & Clank 1 in the PS3 Collection (BCUS98282): investigation status

## Scope and safety

This investigation covers only bolt reading and, if separately validated,
bolt setting for Ratchet & Clank 1 inside the PS3 Collection. The standalone
RC1 address in `games/rc1_ps3_npua80643.js` is an unverified candidate. The new
`diagnostics/rc1-collection.js` probe reads that candidate only and requests
`PROCESS_VM_READ`; it never writes process memory. No Collection RC1 trainer
profile or write path is enabled by this investigation step.

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

The read-only probe was run against PID `15324`. It returned `read_complete`
for the old standalone candidate, host address `0x3009B9CE0`, with a complete
4-byte big-endian `int32` value of `0`. No HUD count was observed at the same
time, so this result cannot establish whether the candidate is valid or
invalid for Collection RC1.

| Evidence | Observation | Status |
| --- | --- | --- |
| RPCS3 build | `0.0.43-20561-b2e52d63 Alpha | master` | Observed in window and GUI log |
| RPCS3 architecture / firmware | x64 / `4.93` | Observed in GUI log |
| Outer Collection title | `BCUS98282` | Observed in game window title |
| Active subgame / PPU executable | Not established | Requires readable session log or equivalent evidence |
| Guest memory base and active segment range | Not established | Session log could not be read |
| Standalone RC1 bolt candidate | `0x3009B9CE0`, big-endian `int32`, complete value `0` | One read without a paired HUD count; unverified |
| HUD bolt counts | None captured | Requires normal gameplay observations |
| Restart reproduction | Not performed | Requires a second capture after relaunch |
| Write validation | Not performed | Requires independent read evidence and explicit approval |

No address has been confirmed. Do not use the old candidate as a trainer
address based on this observation.

## Next read-only evidence required

Follow the [RC1 Collection capture runbook](rc1-collection-runbook.md) while
the selected game is visibly in normal RC1 gameplay. Capture two different
HUD bolt counts, scan the corresponding memory snapshots, then repeat after
restarting RPCS3 and relaunching RC1. Record all candidates, including mirrors
and rejected matches. Do not copy RC2 base addresses, segment ranges, or
offsets into this investigation.

If these observations do not identify a reproducible authoritative bolt
field, stop at read-only research. If they do, a targeted write experiment on a
backed-up test save still requires explicit user approval before it is run.

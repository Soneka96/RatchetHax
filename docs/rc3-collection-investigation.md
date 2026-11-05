# Ratchet & Clank 3 in the PS3 Collection (BCUS98282): investigation status

## Scope and safety

This work covers bolts only for Ratchet & Clank 3: Up Your Arsenal inside the
PS3 Collection. The standalone profile in `games/rc3_ps3_npua80645.js` was a
candidate source only; the confirmed Collection address below was found from
live gameplay evidence. No other RC3 fields are added. The trainer uses the
shared Collection bolt-only menu and the user-selected one-game workflow.

## Observed RC3 session

The running RPCS3 build was `0.0.43-20561-b2e52d63`, outer title
`BCUS98282`. RPCS3 TTY output identified the RC3 save namespace
`NPUA80645_RC3_SAVEDATA_A` and SKU `UP9000-NPUA80645_00`, with RC3 assets under
`/rc3/ps3data`. The exact active PPU SELF filename/build was not established.

`VirtualQueryEx` on RPCS3 PID `15324` observed the host guest-memory
reservation at `0x300000000`. The mapped range used for the scan began at host
`0x300BD0000` (guest `0x00BD0000`) and was `0x00F10000` bytes long. This is
process-map evidence; the RPCS3 log did not confirm it as the complete RC3 PPU
segment. The tested candidate addresses fall inside this observed range.

The user reported 753 HUD bolts. A complete four-byte big-endian read of the
old standalone candidate `0x300C1E4DC` returned zero, so that address does not
match this Collection observation.

## Differential scan and candidate validation

Read-only snapshots of the same mapped range tracked a normal gameplay change
from 753 to 755. The scanner found two aligned big-endian `uint32` candidates:

| Role | Guest address | Host address | 753 → 755 |
| --- | ---: | ---: | --- |
| Candidate A | `0x00C1EDAC` | `0x300C1EDAC` | Matched |
| Candidate B | `0x00DA6664` | `0x300DA6664` | Matched |

Complete reads returned 755 at both candidates. Under the user's explicit
instruction, Candidate A was set to 1,755 (+1,000) and Candidate B to 5,755
(+5,000), each with full four-byte read-back. After 500 ms both retained their
separate values. The user confirmed the HUD showed 1,755, identifying Candidate
A as the field driving the displayed bolt count for this session. Candidate B
is not the authoritative HUD field; its behavior after ordinary gameplay
changes and restart remains unverified. No save file was edited directly.

## Trainer integration and limitations

`games/rc3_ps3_bcus98282.js` now contains only Candidate A as the bolt field.
The RC3 Collection selector uses the shared bolt-only trainer path; no health,
weapons, gadgets, unlocks, teleportation, or other trainer features are
available. Set Bolts uses the same in-process `Game.bolts`/`memoryjs` path as
RC1 and RC2, with a read-back comparison. `Game` resets memoryjs endian types
when the trainer switches profiles. Bolt-only Quit returns to the game-version
list on the selected emulator process.

After integration, constructing `Game` with the RC3 Collection profile and
reading its bolt property returned `56,924` from `0x300C1EDAC`. No HUD count
was captured at that moment, so this is a live read-path smoke check, not a new
address-validation sample.

At the user's direction, the Collection trainer relies on explicit profile
selection while one embedded game is open; no automatic runtime subgame guard
is implemented. The games share outer title ID `BCUS98282`, so selecting the
RC3 profile while another Collection game is active can target the wrong
address. `memoryjs` preserved the tested full x64 host address, but its native
calls do not expose Win32 success flags or byte counts; read-back is used to
check Set Bolts.

After adding the RC3 profile and shared routing, `node --test` passed all 66
tests and the RPCS3 read/snapshot Pester suite passed all 19 tests.

## Remaining verification

The address and user-confirmed HUD write are verified for this session.
Restart reproduction, the exact PPU SELF build identity, and a
PPU-log-confirmed segment range remain unverified. Keep PR #1 in draft until
those gaps are resolved and the implementation is committed and pushed.

# RC2 in the PS3 Collection (BCUS98282): compatibility findings

## Scope and safety

This investigation compares the standalone RC2 profile (`NPUA80644`) with
Ratchet & Clank 2 launched from the three-game PS3 Collection (`BCUS98282`). The
diagnostic, snapshot, and diff tools in this repository are read-only. A
bolt-only Collection trainer profile is now available; it exposes no other
game fields.

During this user-authorized investigation, a separate one-off memory write was
used to validate the bolt candidate. It changed live RAM only; the user
confirmed the HUD value. This was a session-specific experiment, not a trainer
feature or permission to write other Collection addresses.

## How this Collection boots RC2

Sony describes the Collection as containing the first three games: Ratchet &
Clank, Going Commando, and Up Your Arsenal. [PlayStation's Collection announcement](https://blog.playstation.com/2012/07/16/ratchet-clank-collection-hits-august-28th-with-sly-cooper-demo/)

The local RPCS3 log shows the outer disc title as `BCUS98282`, launching its
`EBOOT.BIN`. When RC2 is selected, RPCS3 directly boots
`PS3_GAME/USRDIR/RC2.ppu.self`; the outer Collection serial remains
`BCUS98282`. The running RC2 code reports the internal app/SKU identity
`NPUA80644` and uses save directory `NPUA80644_RC2_SAVEDATA_A`.

This explains why the Collection can retain the standalone-looking RC2 save
namespace while having a separate subgame executable. The matching app name
and save prefix do not prove that the embedded `RC2.ppu.self` has the same

## Address mapping and confirmed bolt field

RPCS3's [memory implementation](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/Emu/Memory/vm.cpp)
reserves the guest memory base at runtime. In the user's active RPCS3 session,
the log recorded `vm::g_base_addr = 0x0000000300000000`. That is the expected
base for the existing profile's `0x3...` host addresses in this session, so a
shifted RPCS3 base does not explain the observed bolt mismatch here.

The RC2 PPU log reports a data segment beginning at guest address `0x012E0000`
with memory size `0x00CF3990`. The candidate bolt address found by differential
scanning is inside this segment:

| Role | Guest address | Host address | Evidence |
| --- | ---: | ---: | --- |
| Bolt field candidate | `0x01329E80` | `0x301329E80` | Changed with HUD bolts and passed the live write check |
| Mirrored bolt candidate | `0x0157E080` | `0x30157E080` | Followed the first value after the game updated |
| Old standalone profile candidate | `0x01329A90` | `0x301329A90` | Read zero while the HUD showed over 244,000 bolts |

Two complete, read-only snapshots matched both candidate locations to a normal
HUD change from 244,012 to 244,016. Under the user's explicit authorization, a
separate test then changed the first candidate from 243,866 to 244,866. The
value read back, the second location synchronized to 244,866, and the user
confirmed that the HUD showed 244,866. This confirms `0x301329E80` as the bolt
field for the tested RC2 Collection session; `0x30157E080` behaves like a
mirror. The old NPUA80644 bolt address is not correct for this session.

The scan and read APIs verified full byte counts. A successful read only means
the address was readable; semantic validation came from the before/after HUD
counts and the user's confirmation.

[`games/rc2_ps3_bcus98282.js`](../games/rc2_ps3_bcus98282.js) contains only the
confirmed bolt field, its big-endian `uint32` type, the tested guest base and
offset, and Collection/subgame identity metadata. The trainer selector names it
“Ratchet & Clank 2: Going Commando [Collection BCUS98282] - Bolts only.” That
mode shows and sets bolts, refreshes the count, or exits; it skips the generic
metrics and other game features. A user-authorized test write changed the
confirmed field from 243,866 to 244,866 and the HUD matched. The diagnostic
reader and snapshot scanner remain read-only; this one-off test does not
validate any other write address.

## Remaining field and build status

Only the bolt field has been validated in the Collection. The health,
multiplier, planet ID, equipped item, weapon, gadget, and unlock candidates from
the standalone profile remain unsupported. In the captured session, the old
health and multiplier candidates returned zero while the HUD showed 40/40
health and a ×12 multiplier; the planet candidate returned ID 46, outside the
standalone profile's known planet IDs 0–26.

The internal `NPUA80644` identity and save namespace are confirmed, but no
byte-for-byte comparison of the Collection's `RC2.ppu.self` against the
standalone executable was performed. The broader reason the remaining offsets
differ is unresolved. Collection Game 1 now has a bolt-only profile based on
its separate investigation; Collection Game 3 remains unsupported. Do not add
unverified fields to the BCUS98282 profiles or expose unsupported trainer
actions.

The [read-only diagnostics runbook](rc2-collection-runbook.md) documents the
snapshot and diff procedure. Keep snapshots local unless they are deliberately
shared; they contain raw game memory from the selected range.

## Sources

- [PlayStation Blog: Ratchet & Clank Collection announcement](https://blog.playstation.com/2012/07/16/ratchet-clank-collection-hits-august-28th-with-sly-cooper-demo/)
- [RPCS3 guest-memory implementation](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/Emu/Memory/vm.cpp)
- [Microsoft `ReadProcessMemory` documentation](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory)

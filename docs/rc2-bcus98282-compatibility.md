# Ratchet & Clank Collection (BCUS98282): RC2 compatibility status

## Confirmed for the tested session

- RPCS3 boots the Collection under outer title ID `BCUS98282`. Selecting RC2
  directly boots `RC2.ppu.self`; the running RC2 code reports internal app/SKU
  identity `NPUA80644` and save namespace `NPUA80644_RC2_SAVEDATA_A`.
- The active RPCS3 log recorded `g_base_addr = 0x300000000`. The old standalone
  bolt candidate `0x301329A90` was readable but returned zero while the HUD
  showed 244,000+ bolts.
- Differential snapshots identified `0x301329E80` as the live bolt field for
  this session. A second location, `0x30157E080`, followed as a mirror. The
  first address was tested with a user-authorized +1,000 RAM change; the HUD
  displayed 244,866. The diagnostic tools themselves remain read-only.

The app/save identity does not prove that the embedded RC2 executable has the
same memory layout as the standalone NPUA80644 release. The original profile's
bolt offset is invalid for the tested Collection instance.

## Compatibility boundary

Only the bolt field has been validated in this session. Health, multiplier,
planet, equipped item, ammo, and unlock fields remain unsupported unless each
is independently compared with gameplay. The new
`games/rc2_ps3_bcus98282.js` profile contains only the confirmed bolt field.
Its trainer mode exposes bolt display, refresh, Set Bolts, and Quit; it hides
the regular trainer's unverified actions. Do not select the standalone
NPUA80644 profile for the Collection.

The user authorized a targeted live-memory test write while using a test save.
The confirmed bolt field changed from 243,866 to 244,866 and the user confirmed
the HUD. The bolt-only trainer setter writes only this validated field. The
diagnostic, snapshot, and diff tools remain read-only; no save-file write was
performed directly by these tools.

For repeatable read-only snapshots and address scans, follow the
[snapshot and diff runbook](rc2-collection-runbook.md). The full evidence and
remaining questions are in the [compatibility investigation](rc2-collection-investigation.md).

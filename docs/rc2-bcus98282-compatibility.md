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
is independently compared with gameplay. Do not create a populated
`games/rc2_ps3_bcus98282.js` profile from unverified fields, and do not use the
regular trainer's write functions for BCUS98282.

The user authorized one targeted live-memory test write while using a test
save; the write changed process memory and no save-file operation was performed
by the tool. This one-off exception does not enable writes in the diagnostics or
trainer code.

For repeatable read-only snapshots and address scans, follow the
[snapshot and diff runbook](rc2-collection-runbook.md). The full evidence and
remaining questions are in the [compatibility investigation](rc2-collection-investigation.md).

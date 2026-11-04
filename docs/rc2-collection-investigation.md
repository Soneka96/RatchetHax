# RC2 Collection memory compatibility investigation

## Scope

This note investigates whether the existing Ratchet & Clank 2 PS3 profile can be
trusted for RC2 running as part of the PS3 Collection (`BCUS98282`) in RPCS3.
It does not add a Collection profile or enable memory writes. All existing
`NPUA80644` values are treated as unverified candidates for the Collection.

## Findings confirmed from the local code

- The only RC2 PS3 profile in this checkout is
  [`games/rc2_ps3_npua80644.js`](../games/rc2_ps3_npua80644.js). It identifies
  `NPUA80644` in its comment, sets `bigEndian: true`, and stores addresses such
  as `0x301329A90` as JavaScript numeric literals. The local Collection address
  profile and the diagnostic probes mentioned in the task brief are not present
  in the files inspected in this checkout.
- [`Game.js`](../Game.js) passes profile addresses to `memoryjs.readMemory` and
  sets the addon's scalar data type constants to big-endian variants for this
  profile. It returns the addon's result directly; it has no read-status or
  byte-count channel.
- The installed dependency is `memoryjs` 3.5.1, as recorded in
  `package-lock.json`. Its native `openProcess` implementation calls
  `OpenProcess(PROCESS_ALL_ACCESS, ...)`, so the trainer does not request
  read-only access.
- For this profile's big-endian fields, the `memoryjs` JavaScript wrapper
  routes scalar reads through `readBuffer` and decodes the returned buffer with
  Node's big-endian buffer methods. The native buffer path ignores
  `ReadProcessMemory`'s Boolean result and byte count, then returns a buffer of
  the requested length. This means the path used by fields such as bolts
  cannot distinguish a valid zero from an unsuccessful or incomplete read.
  Non-big-endian scalar fields, such as the profile's `uint8` item and planet
  IDs, use the native scalar template: it passes a null byte-count pointer,
  ignores the API result, and leaves its destination uninitialized before the
  call. Neither path provides a reliable read-status signal to `Game.js`.
- The native address argument is accepted as a JavaScript `Number`, converted
  to `Int64Value`, stored as `DWORD64`, and cast to `LPVOID` at the Windows API
  call. The current profile's `0x3...` addresses are far below JavaScript's
  exact-integer limit of `2^53`, so they are exactly representable as Numbers.
  This rules out simple 32-bit truncation inside JavaScript Number storage for
  these constants, but does not establish correctness for arbitrary 64-bit
  addresses or for a 32-bit native build. The checked-in Windows setup guide
  builds the x64 addon; that is relevant to the pointer cast but is not evidence
  that any game address is correct.
- The local `CheatEngineTables` files inspected contain a PS2 RC2 table, not a
  live-memory map for the PS3 Collection. The public `NPUA80644` cheat material
  found during this investigation concerns save-data offsets, not RPCS3 process
  virtual addresses; it cannot validate this profile.

## RPCS3 address mapping

RPCS3's current [`vm.cpp`](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/Emu/Memory/vm.cpp)
reserves its emulated memory at runtime. Its reservation helper tries 4 GiB
steps starting at `0x3_0000_0000` and continues searching higher addresses;
the guest memory base is the address returned by that search. This supports
the hypothesis that a fixed `0x300000000 + guest address` calculation is not
universally valid. It does **not** prove which base a particular Windows RPCS3
process selected. That must be observed from the running process before any
derived host address can be trusted.

## Read API requirements

Microsoft documents that `ReadProcessMemory` requires a handle with
`PROCESS_VM_READ`, returns a success flag, accepts an output pointer for the
number of bytes transferred, and exposes extended failure information through
`GetLastError`. It also states that the requested region must be accessible.
The current `memoryjs` path discards the success and byte-count results, so it
does not meet the diagnostics requirement. A replacement probe should request
only the required read permission and report the address, requested/returned
byte counts, success state, and Windows error code. A decoded value should be
emitted only after a complete successful read.

Source: [Microsoft `ReadProcessMemory` documentation](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory).

## Findings that remain hypotheses

These are plausible explanations, not established root causes:

1. RPCS3 may have selected a guest-memory host base other than the assumed
   `0x300000000` base.
2. The standalone `NPUA80644` values may not match the RC2 executable/build
   inside `BCUS98282`.
3. Failed or short native reads may currently appear as values because the
   addon suppresses the Win32 read result.
4. A candidate may use the wrong type, byte order, or game-state interpretation.
5. The selected process may be RPCS3 while RC2 is not in a state where the
   candidate fields are populated.

The existing evidence does not establish which of these explains the reported
implausible readings. Attaching to `rpcs3.exe`, or observing a plausible-looking
number, is not sufficient proof of Collection compatibility.

## Evidence still needed

Collection compatibility needs repeatable observations from the user's Windows
11/RPCS3 session: record the RPCS3 version and loaded game identity, visible
bolts and planet, then collect diagnostics during play and again after a
legitimate bolt-count change. The probe must show complete successful reads
for each field and correlate the bolt candidate with both visible observations.
Health, equipped item, planet, weapon, and unlock candidates require separate
gameplay checks before they can be described as verified.

Until those checks and address provenance are available, `BCUS98282` remains
unsupported and read-only. No Collection address profile is added here.

## Sources

- RPCS3 source: [`rpcs3/Emu/Memory/vm.cpp`](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/Emu/Memory/vm.cpp)
- `memoryjs` upstream project: [Rob--/memoryjs](https://github.com/Rob--/memoryjs). The implementation details above were checked against the locally installed 3.5.1 source referenced by `package-lock.json`.
- Windows API: [Microsoft `ReadProcessMemory` documentation](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-readprocessmemory)
- Game identifier reference: [NPUA80644 save-code listing](https://www.save-editor.com/tools_original/wse_ps3_save_editor_code_title.html?id=NPUA80644), which describes save-data patches and is **not** used as live-memory address evidence.

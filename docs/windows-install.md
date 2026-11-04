# Windows native installation (RatchetHax)

## Problem

`memoryjs@3.5.1` runs `node ./scripts/install.js` during a normal `npm install`. That launcher tries to spawn `npm.cmd run build64` and can fail with `spawn EINVAL` on this Windows environment. A plain `npm install` therefore fails even when Visual Studio C++ and Python are present.

This repository's setup script **skips lifecycle scripts during dependency installation**, then compiles memoryjs directly through its `build64` script, without invoking the problematic launcher.

## Requirements (known local combination)

- Windows x64
- Node.js **18.20.8** (legacy compatibility only; this Node version is EOL)
- Python **3.12**, available via `py -3.12`
- Visual Studio **2022 Build Tools**, with *Desktop development with C++* and x64/x86 MSVC tools
- Windows SDK installed alongside Build Tools

Other versions have not yet been validated by this project.

## Run from the repository root

```powershell
cd "C:\Project\RatchetHax"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\setup-windows.ps1"
```

This script checks its prerequisites, runs `npm install --ignore-scripts --no-audit`, sets the Python/VS selection **for its process only**, builds `memoryjs` x64, tests that the compiled native addon loads, and checks the trainer syntax. It does not change global PATH, registry, or install tools.

You can alternatively run `npm run setup:windows` if npm itself is already available.

**If `EPERM` appears:** stop any running trainer and close editors/terminals holding `node_modules` files open; retry. Do not automatically delete project files or disable antivirus. If the failure persists, capture the specific locked path.

**If MSVC is not found:** use Visual Studio Installer → Build Tools 2022 → Modify → Desktop development with C++. Merely having Visual Studio 2026 installed is not sufficient for the currently used node-gyp 10 toolchain.

**If the native build fails:** preserve the build logs and capture the precise `node-gyp` error. The script stops without claiming success.

## Scope and limitations

- Successful setup proves only that the addon compiles/loads on the user's machine.
- It does **not** prove RC2 Collection `BCUS98282` memory addresses are correct.
- The existing RC2 profile is for `NPUA80644`, not the disc Collection.
- C++ pointer-truncation warnings in `memoryjs` must be reviewed before trusting the code paths involved.
- Do **not** enable memory writes against `BCUS98282` until the game's identity and address table have been validated using independent observations.
- Dependency security modernization and compatibility with a supported Node LTS version remain future tasks; `--ignore-scripts` can skip other package lifecycle scripts, so this workaround is project-specific and requires testing.

# Windows setup for RatchetHax (Node.js + memoryjs native addon)
# Run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
# No elevation, global package installs, registry edits, or OS configuration changes.
[CmdletBinding()]
param([switch]$SkipInstall)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Exit([string] $Action) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    Write-Host 'RatchetHax Windows setup' -ForegroundColor Cyan
    Write-Host "Project: $root"

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        throw 'Node.js not found on PATH.'
    }
    $nodeExecutable = $nodeCommand.Source

    # npm.cmd need not be on PATH (for example with some Windows Node version managers).
    # Prefer invoking the npm CLI bundled beside the selected node.exe directly.
    $npmCli = Join-Path (Split-Path -Parent $nodeExecutable) 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $npmCli) {
        $npmRunner = $nodeExecutable
        $npmPrefix = @($npmCli)
        Write-Host "npm CLI: $npmCli"
    } else {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npmCommand) {
            throw "Could not find npm-cli.js alongside node.exe or npm.cmd on PATH. Node path: $nodeExecutable"
        }
        $npmRunner = $npmCommand.Source
        $npmPrefix = @()
        Write-Host "npm command: $npmRunner"
    }

    $nodeVersion = (& $nodeExecutable -p "process.versions.node").Trim()
    Assert-Exit 'Node.js version check'
    if ($nodeVersion -ne '18.20.8') {
        Write-Warning "Node.js $nodeVersion detected. The verified local native build used 18.20.8; other versions are unverified."
    }
    Write-Warning 'Node 18 is EOL. Only use it as a temporary legacy compatibility environment.'

    if (-not (Get-Command py.exe -ErrorAction SilentlyContinue)) {
        throw 'Python Launcher py.exe not found. Install Python 3.12.'
    }
    $pythonExe = (& py.exe -3.12 -c 'import sys; print(sys.executable)' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not $pythonExe -or -not (Test-Path $pythonExe)) {
        throw 'Python 3.12 not found. Install it and retry.'
    }
    $env:npm_config_python = "$pythonExe"
    $env:PYTHON = "$pythonExe"
    Write-Host "Python: $pythonExe"

    $vswhere = Join-Path ([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw 'vswhere.exe not found. Install VS 2022 Build Tools with Desktop development with C++.'
    }
    $vsMatches = @(& $vswhere -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if ($LASTEXITCODE -ne 0 -or $vsMatches.Count -eq 0 -or -not $vsMatches[0]) {
        throw 'Visual Studio 2022 MSVC x64/x86 tools not detected. Install Desktop development with C++.'
    }
    $env:GYP_MSVS_VERSION = '2022'
    $env:npm_config_msvs_version = '2022'
    Write-Host "MSVC: $($vsMatches[0])"

    if (-not $SkipInstall) {
        Write-Host 'Installing dependencies with native install scripts disabled...' -ForegroundColor Cyan
        Write-Host 'If EPERM occurs, close processes locking node_modules and retry.'
        & $npmRunner @npmPrefix install --ignore-scripts --no-audit
        Assert-Exit 'npm install --ignore-scripts'
    }

    $addonDirectory = Join-Path $root 'node_modules\memoryjs'
    if (-not (Test-Path (Join-Path $addonDirectory 'package.json'))) {
        throw 'memoryjs is missing; rerun setup without -SkipInstall.'
    }
    Push-Location $addonDirectory
    try {
        Write-Host 'Building memoryjs x64 directly...' -ForegroundColor Cyan
        & $npmRunner @npmPrefix run build64
        Assert-Exit 'memoryjs build64'
    } finally {
        Pop-Location
    }

    Write-Host 'Smoke-testing native addon loading...' -ForegroundColor Cyan
    & $nodeExecutable -e "const m = require('./node_modules/memoryjs'); if(typeof m.readMemory !== 'function') process.exit(2); console.log('memoryjs loaded successfully');"
    Assert-Exit 'memoryjs smoke test'
    & $nodeExecutable --check trainer.js
    Assert-Exit 'trainer syntax check'
    Write-Host 'Install verification succeeded. Game memory compatibility remains UNVERIFIED.' -ForegroundColor Green
    Write-Host 'Do not use the original trainer write functions with Collection BCUS98282.'
} finally {
    Pop-Location
}

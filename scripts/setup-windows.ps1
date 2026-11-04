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

    $nodeVersion = (& $nodeExecutable -p "process.versions.node").Trim()
    Assert-Exit 'Node.js version check'

    # Some Windows Node managers expose node.exe through a .nodejs shim.
    # npm-cli.js is then under installs\v<version>, not beside the shim.
    # Resolve the actual binary AND the installed version directory first.
    $realNodeExecutable = (& $nodeExecutable -p "require('fs').realpathSync(process.execPath)").Trim()
    Assert-Exit 'Node.js actual-path lookup'
    $nodeDirectory = Split-Path -Parent $nodeExecutable
    $realNodeDirectory = Split-Path -Parent $realNodeExecutable
    $versionManagerRoot = Split-Path -Parent $nodeDirectory
    $npmCandidates = @(
        (Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js')
        (Join-Path $realNodeDirectory 'node_modules\npm\bin\npm-cli.js')
        (Join-Path $versionManagerRoot ("installs\v{0}\node_modules\npm\bin\npm-cli.js" -f $nodeVersion))
    )
    $npmCli = $npmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($npmCli) {
        $npmRunner = $nodeExecutable
        $npmPrefix = @($npmCli)
        Write-Host "npm CLI: $npmCli"
    } else {
        # Fallback to whichever npm launcher PowerShell can actually run.
        # npm.ps1 works here too: this setup is launched with ExecutionPolicy Bypass.
        $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
        if (-not $npmCommand -or $npmCommand.CommandType -notin @('Application', 'ExternalScript')) {
            throw "npm not found. Checked actual Node location and version-manager install for Node $nodeVersion. Confirm that npm is installed for the selected Node version."
        }
        $npmRunner = $npmCommand.Source
        $npmPrefix = @()
        Write-Host "npm launcher: $npmRunner"
    }

    if ($nodeVersion -ne '18.20.8') {
        Write-Warning "Node.js $nodeVersion detected. The verified local native build used 18.20.8; other versions are unverified."
    }
    Write-Warning 'Node 18 is EOL. Only use it as a temporary legacy compatibility environment.'

    # Python 3.12 was independently verified on this Windows machine.
    # Windows PowerShell 5.1 can strip embedded quotes from native -c arguments;
    # avoid any quoted Python string literals in probe commands.
    $pythonCandidates = @(
        @{ Launcher = (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'); Prefix = @() },
        @{ Launcher = (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'); Prefix = @() },
        @{ Launcher = 'py.exe'; Prefix = @('-3.12') },
        @{ Launcher = 'py.exe'; Prefix = @('-3.11') },
        @{ Launcher = 'python.exe'; Prefix = @() }
    )

    $pythonExe = $null
    $pythonVersion = $null
    foreach ($candidate in $pythonCandidates) {
        $cmd = Get-Command $candidate.Launcher -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        $commandArgs = @($candidate.Prefix) + @(
            '-c',
            'import sys;print(sys.executable);print(sys.version_info.major);print(sys.version_info.minor)'
        )
        try {
            $result = @(& $cmd.Source @commandArgs 2>$null)
            if ($LASTEXITCODE -ne 0 -or $result.Count -lt 3) { continue }
            $candidatePath = ([string]$result[0]).Trim()
            $candidateMajor = ([string]$result[1]).Trim()
            $candidateMinor = ([string]$result[2]).Trim()
            $candidateVersion = "$candidateMajor.$candidateMinor"
            if ($candidateVersion -in @('3.12', '3.11') -and
                (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
                $pythonExe = $candidatePath
                $pythonVersion = $candidateVersion
                break
            }
        } catch {
            # A missing launcher version should not prevent trying other installs.
        }
    }
    if (-not $pythonExe) {
        throw 'Python 3.12 or 3.11 not detected. Run "py -0p" and "where.exe python" and provide the result; do not reinstall Python without checking the reported paths.'
    }
    $env:npm_config_python = $pythonExe
    $env:PYTHON = $pythonExe
    Write-Host ("Python {0}: {1}" -f $pythonVersion, $pythonExe)

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

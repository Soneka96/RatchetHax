<#
.SYNOPSIS
Read-only compatibility probe for RC2 inside PS3 disc Collection BCUS98282.
.DESCRIPTION
Checks the NPUA80644 profile's candidate addresses against running RPCS3.
Uses Windows ReadProcessMemory directly and checks its success and byte count.
Does not modify the emulator or game memory. Results are NOT validated
BCUS98282 offsets and should be compared to known values displayed in-game.
.EXAMPLE
.\scripts\probe-rc2-bcus98282.ps1 -ProcessId (Get-Process rpcs3).Id
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$ProcessId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$target = Get-Process -Id $ProcessId -ErrorAction Stop
if ($target.ProcessName -ine "rpcs3") {
    throw "Process ID $ProcessId is not RPCS3. Nothing was read."
}

if (-not ("RatchetHaxReadOnlyMemory" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RatchetHaxReadOnlyMemory
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ReadProcessMemory(
        IntPtr process, IntPtr address, [Out] byte[] buffer,
        IntPtr size, out IntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
}

# PROCESS_VM_READ (0x10) | PROCESS_QUERY_LIMITED_INFORMATION (0x1000).
# No PROCESS_VM_WRITE, PROCESS_VM_OPERATION or PROCESS_CREATE_THREAD rights.
$handle = [RatchetHaxReadOnlyMemory]::OpenProcess(0x1010, $false, $ProcessId)
if ($handle -eq [IntPtr]::Zero) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "OpenProcess failed (Windows error $err): $([ComponentModel.Win32Exception]::new($err).Message)"
}

# Candidate host addresses copied from games/rc2_ps3_npua80644.js.
# They are NOT established as valid for Collection BCUS98282.
$checks = @(
    @{ Name = "Bolts"; Address = 0x301329A90L; Kind = "u32be" },
    @{ Name = "Nanotech"; Address = 0x3014816ACL; Kind = "u32be" },
    @{ Name = "Raritanium"; Address = 0x301329A94L; Kind = "u32be" },
    @{ Name = "Multiplier"; Address = 0x301329ACAL; Kind = "u8" },
    @{ Name = "Planet ID"; Address = 0x301329A3FL; Kind = "u8" },
    @{ Name = "Equipped item"; Address = 0x30147F1BBL; Kind = "u8" },
    @{ Name = "Lancer unlocked"; Address = 0x301481A9EL; Kind = "u8" },
    @{ Name = "Lancer ammo"; Address = 0x3014818A4L; Kind = "u32be" },
    @{ Name = "Swingshot unlocked"; Address = 0x301481A8DL; Kind = "u8" }
)

Write-Host "Ratchet & Clank 2 Collection BCUS98282 - READ-ONLY"
Write-Host "RPCS3 process: $ProcessId"
Write-Host "Testing NPUA80644 candidate addresses; these are NOT verified for BCUS98282."
Write-Host "Run during actual RC2 gameplay, NOT the Collection menu."
Write-Host "No game memory will be modified."
Write-Host ""

try {
    foreach ($check in $checks) {
        $count = if ($check.Kind -eq "u8") { 1 } else { 4 }
        $buffer = New-Object byte[] $count
        $bytesRead = [IntPtr]::Zero
        $address = [IntPtr]::new([long]$check.Address)
        $success = [RatchetHaxReadOnlyMemory]::ReadProcessMemory(
            $handle, $address, $buffer, [IntPtr]::new($count), [ref]$bytesRead
        )
        $addressLabel = "0x{0:X}" -f [long]$check.Address

        if (-not $success -or $bytesRead.ToInt64() -ne $count) {
            $win32 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            $message = if ($success) {
                "partial read: $($bytesRead.ToInt64())/$count bytes"
            } else {
                "Windows error $win32 ($([ComponentModel.Win32Exception]::new($win32).Message))"
            }
            Write-Host ("{0,-19} {1}: READ FAILED - {2}" -f $check.Name, $addressLabel, $message)
            continue
        }

        if ($count -eq 1) {
            $value = [uint32]$buffer[0]
        } else {
            [Array]::Reverse($buffer) # PS3 values are big-endian, Windows little-endian.
            $value = [BitConverter]::ToUInt32($buffer, 0)
        }
        $extra = if ($check.Name -eq "Planet ID" -and $value -gt 26) {
            " [outside the NPUA80644 known planet IDs 0..26]"
        } else { "" }
        Write-Host ("{0,-19} {1}: {2}{3}" -f $check.Name, $addressLabel, $value, $extra)
    }
} finally {
    [void][RatchetHaxReadOnlyMemory]::CloseHandle($handle)
}

Write-Host ""
Write-Host "Compare bolts / nanotech / planet to the game's on-screen data."
Write-Host "Correct-looking values are not enough; verify a normal in-game value change."
Write-Host "If Windows reports failed reads, do NOT use the old trainer to write memory."

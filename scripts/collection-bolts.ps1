[CmdletBinding()]
param(
    [switch]$LibraryOnly,
    [ValidateSet('read', 'write')][string]$Mode,
    [int]$ProcessId,
    [string]$Address,
    [string]$Value
)

$ErrorActionPreference = 'Stop'

function Initialize-CollectionBoltNativeMemory {
    if ('RatchetHax.CollectionBoltMemory' -as [type]) { return }

    $nativeSource = @'
using System;
using System.Runtime.InteropServices;

namespace RatchetHax
{
    public sealed class OpenResult
    {
        public IntPtr Handle { get; set; }
        public int ErrorCode { get; set; }
    }

    public sealed class ReadResult
    {
        public bool Success { get; set; }
        public ulong BytesRead { get; set; }
        public int ErrorCode { get; set; }
        public byte[] Bytes { get; set; }
    }

    public sealed class WriteResult
    {
        public bool Success { get; set; }
        public ulong BytesWritten { get; set; }
        public int ErrorCode { get; set; }
    }

    public static class CollectionBoltMemory
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, [Out] byte[] buffer, UIntPtr size, out UIntPtr bytesRead);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr bytesWritten);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        public static OpenResult Open(uint processId, uint access)
        {
            IntPtr handle = OpenProcess(access, false, processId);
            return new OpenResult {
                Handle = handle,
                ErrorCode = handle == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0
            };
        }

        public static ReadResult Read(IntPtr handle, ulong address, int requestedBytes)
        {
            byte[] buffer = new byte[requestedBytes];
            UIntPtr transferred;
            bool success = ReadProcessMemory(handle, new IntPtr(unchecked((long)address)), buffer,
                new UIntPtr((uint)requestedBytes), out transferred);
            return new ReadResult {
                Success = success,
                BytesRead = transferred.ToUInt64(),
                ErrorCode = success ? 0 : Marshal.GetLastWin32Error(),
                Bytes = buffer
            };
        }

        public static WriteResult Write(IntPtr handle, ulong address, byte[] bytes)
        {
            UIntPtr transferred;
            bool success = WriteProcessMemory(handle, new IntPtr(unchecked((long)address)), bytes,
                new UIntPtr((uint)bytes.Length), out transferred);
            return new WriteResult {
                Success = success,
                BytesWritten = transferred.ToUInt64(),
                ErrorCode = success ? 0 : Marshal.GetLastWin32Error()
            };
        }

        public static void Close(IntPtr handle)
        {
            if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }
}
'@

    Add-Type -TypeDefinition $nativeSource -ErrorAction Stop | Out-Null
}

function ConvertFrom-CollectionUInt64 {
    param([Parameter(Mandatory = $true)][string]$Text)
    if ($Text -match '^0x[0-9a-fA-F]{1,16}$') {
        return [Convert]::ToUInt64($Text.Substring(2), 16)
    }
    if ($Text -match '^\d+$') {
        return [Convert]::ToUInt64($Text, 10)
    }
    throw 'Address must be an unsigned decimal or hexadecimal integer.'
}

function ConvertFrom-CollectionUInt32 {
    param([Parameter(Mandatory = $true)][string]$Text)
    if (-not ($Text -match '^\d+$')) { throw 'Value must be an unsigned decimal integer.' }
    try { $value = [Convert]::ToUInt32($Text, 10) } catch { throw 'Value must fit an unsigned 32-bit integer.' }
    return $value
}

function ConvertTo-CollectionBigEndianUInt32 {
    param([Parameter(Mandatory = $true)][uint32]$Value)
    [byte[]]@(
        [byte](($Value -shr 24) -band 0xff),
        [byte](($Value -shr 16) -band 0xff),
        [byte](($Value -shr 8) -band 0xff),
        [byte]($Value -band 0xff)
    )
}

function ConvertFrom-CollectionBigEndianUInt32 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    if ($Bytes.Length -ne 4) { throw 'A bolt value requires exactly four bytes.' }
    [uint32](([uint64]$Bytes[0] -shl 24) -bor ([uint64]$Bytes[1] -shl 16) -bor
        ([uint64]$Bytes[2] -shl 8) -bor [uint64]$Bytes[3])
}

function Get-CollectionReadValue {
    param(
        [Parameter(Mandatory = $true)][object]$Read,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ($null -eq $Read -or -not [bool]$Read.Success) {
        return [ordered]@{ status = 'read_failed'; errorCode = if ($null -eq $Read) { 0 } else { [int]$Read.ErrorCode }; bytesRead = if ($null -eq $Read) { 0 } else { [uint64]$Read.BytesRead } }
    }
    $bytes = [byte[]]$Read.Bytes
    if ([uint64]$Read.BytesRead -ne 4 -or $bytes.Length -ne 4) {
        return [ordered]@{ status = 'read_partial'; errorCode = [int]$Read.ErrorCode; bytesRead = [uint64]$Read.BytesRead }
    }
    return [ordered]@{ status = 'read_complete'; value = (ConvertFrom-CollectionBigEndianUInt32 -Bytes $bytes); bytesRead = [uint64]$Read.BytesRead; name = $Name }
}

function Invoke-CollectionBoltMemory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateSet('read', 'write')][string]$Mode,
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$Address,
        [string]$Value,
        [scriptblock]$OpenAction,
        [scriptblock]$ReadAction,
        [scriptblock]$WriteAction,
        [scriptblock]$CloseAction,
        [Nullable[bool]]$ArchitectureIs64Bit
    )

    $is64BitProcess = [Environment]::Is64BitProcess
    if ($null -ne $ArchitectureIs64Bit) { $is64BitProcess = [bool]$ArchitectureIs64Bit }
    if (-not $is64BitProcess) { throw 'A 64-bit PowerShell process is required to preserve RPCS3 host addresses.' }
    if ($ProcessId -le 0) { throw 'ProcessId must be positive.' }
    if (-not ($Address -match '^0x[0-9a-fA-F]{1,16}$')) { throw 'Invalid 64-bit address.' }
    $addressValue = ConvertFrom-CollectionUInt64 -Text $Address
    $boltValue = if ($Mode -eq 'write') { ConvertFrom-CollectionUInt32 -Text $Value } else { $null }

    if ($null -eq $OpenAction -or $null -eq $ReadAction -or $null -eq $CloseAction -or ($Mode -eq 'write' -and $null -eq $WriteAction)) {
        Initialize-CollectionBoltNativeMemory
        if ($null -eq $OpenAction) {
            $OpenAction = {
                param($processId, $access)
                [RatchetHax.CollectionBoltMemory]::Open([uint32]$processId, [uint32]$access)
            }
        }
        if ($null -eq $ReadAction) {
            $ReadAction = {
                param($handle, $address, $size)
                [RatchetHax.CollectionBoltMemory]::Read($handle, [uint64]$address, [int]$size)
            }
        }
        if ($null -eq $WriteAction) {
            $WriteAction = {
                param($handle, $address, $bytes)
                [RatchetHax.CollectionBoltMemory]::Write($handle, [uint64]$address, [byte[]]$bytes)
            }
        }
        if ($null -eq $CloseAction) {
            $CloseAction = { param($handle) [RatchetHax.CollectionBoltMemory]::Close($handle) }
        }
    }

    $access = if ($Mode -eq 'write') { [uint32]0x0038 } else { [uint32]0x0010 }
    $open = & $OpenAction $ProcessId $access
    $invalidHandle = $null -eq $open -or $null -eq $open.Handle
    if (-not $invalidHandle -and $open.Handle -is [IntPtr]) { $invalidHandle = $open.Handle -eq [IntPtr]::Zero }
    if ($invalidHandle) {
        return [ordered]@{ status = 'open_failed'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); errorCode = if ($null -eq $open) { 0 } else { [int]$open.ErrorCode } }
    }

    try {
        $beforeRaw = & $ReadAction $open.Handle $addressValue 4
        $before = Get-CollectionReadValue -Read $beforeRaw -Name 'before'
        if ($before.status -ne 'read_complete') {
            return [ordered]@{ status = $before.status; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); requestedAccess = if ($Mode -eq 'write') { 'PROCESS_VM_READ|PROCESS_VM_WRITE|PROCESS_VM_OPERATION' } else { 'PROCESS_VM_READ' }; errorCode = $before.errorCode; bytesRead = $before.bytesRead }
        }
        if ($Mode -eq 'read') {
            return [ordered]@{ status = 'read_complete'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); requestedAccess = 'PROCESS_VM_READ'; requestedBytes = 4; bytesRead = 4; value = $before.value }
        }

        $writeRaw = & $WriteAction $open.Handle $addressValue (ConvertTo-CollectionBigEndianUInt32 -Value $boltValue)
        $writeOk = $null -ne $writeRaw -and [bool]$writeRaw.Success -and [uint64]$writeRaw.BytesWritten -eq 4
        $afterRaw = & $ReadAction $open.Handle $addressValue 4
        $after = Get-CollectionReadValue -Read $afterRaw -Name 'after'
        if (-not $writeOk) {
            return [ordered]@{ status = 'write_failed'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); beforeValue = $before.value; requestedValue = $boltValue; success = if ($null -eq $writeRaw) { $false } else { [bool]$writeRaw.Success }; bytesWritten = if ($null -eq $writeRaw) { 0 } else { [uint64]$writeRaw.BytesWritten }; errorCode = if ($null -eq $writeRaw) { 0 } else { [int]$writeRaw.ErrorCode }; afterStatus = $after.status; afterValue = $after.value }
        }
        if ($after.status -ne 'read_complete') {
            return [ordered]@{ status = 'write_verify_failed'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); beforeValue = $before.value; requestedValue = $boltValue; afterStatus = $after.status; errorCode = $after.errorCode; bytesRead = $after.bytesRead }
        }
        if ([uint32]$after.value -ne $boltValue) {
            return [ordered]@{ status = 'write_verify_failed'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); beforeValue = $before.value; requestedValue = $boltValue; afterValue = $after.value; afterStatus = 'read_complete' }
        }
        return [ordered]@{ status = 'write_complete'; processId = $ProcessId; address = ('0x{0:X16}' -f $addressValue); requestedAccess = 'PROCESS_VM_READ|PROCESS_VM_WRITE|PROCESS_VM_OPERATION'; requestedBytes = 4; bytesWritten = [uint64]$writeRaw.BytesWritten; beforeValue = $before.value; value = $boltValue; afterValue = $after.value }
    } finally {
        & $CloseAction $open.Handle
    }
}

if (-not $LibraryOnly) {
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $result = Invoke-CollectionBoltMemory -Mode $Mode -ProcessId $ProcessId -Address $Address -Value $Value
        $result | ConvertTo-Json -Depth 6 -Compress
        if ($result.status -notin @('read_complete', 'write_complete')) { exit 3 }
    } catch {
        [ordered]@{ status = 'backend_error'; message = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
        exit 2
    }
}

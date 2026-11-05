[CmdletBinding()]
param(
    [switch]$LibraryOnly,
    [Nullable[int]]$ProcessId,
    [string]$RequestsBase64,
    [switch]$Snapshot,
    [string]$GuestBase,
    [string]$GuestStart,
    [int]$SnapshotLength,
    [int]$ChunkSize = 65536,
    [string]$SnapshotPath,
    [string]$HudBolts
)

$ErrorActionPreference = 'Stop'

function Get-RpcS3Processes {
    @(Get-Process -Name 'rpcs3' -ErrorAction SilentlyContinue | ForEach-Object {
        $path = $null
        try { $path = $_.Path } catch { }
        [ordered]@{
            id = [int]$_.Id
            name = [string]$_.ProcessName
            path = $path
        }
    })
}

function Resolve-RpcS3Process {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Processes,
        [Nullable[int]]$RequestedProcessId
    )

    if ($null -ne $RequestedProcessId) {
        $selected = $Processes | Where-Object { $_.id -eq $RequestedProcessId } | Select-Object -First 1
        if ($null -eq $selected) {
            return [ordered]@{ status = 'process_not_found'; processId = [int]$RequestedProcessId }
        }
        return [ordered]@{ status = 'selected'; process = $selected }
    }

    if ($Processes.Count -eq 0) {
        return [ordered]@{ status = 'no_rpcs3_process'; processes = @() }
    }
    if ($Processes.Count -gt 1) {
        return [ordered]@{ status = 'selection_required'; processes = @($Processes) }
    }
    return [ordered]@{ status = 'selected'; process = $Processes[0] }
}

function ConvertFrom-Rc2RequestsBase64 {
    param([Parameter(Mandatory = $true)][string]$RequestsBase64)

    $jsonLines = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestsBase64))
    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($jsonLine in ($jsonLines -split "`n")) {
        $line = $jsonLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $request = ConvertFrom-Json -InputObject $line
        if ($request -is [array] -or $null -eq $request) { throw 'Each decoded request line must be one JSON object.' }
        $items.Add($request)
    }

    [ordered]@{ requests = $items.ToArray() }
}

function Get-RpcS3ReadAccessMask {
    # PROCESS_VM_READ only. The probe never requests write or operation rights.
    [uint32]0x0010
}

function ConvertFrom-Rc2Unsigned64 {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $text = $Value.Trim()
    if ($text -match '^0x[0-9a-fA-F]{1,16}$') {
        return [Convert]::ToUInt64($text.Substring(2), 16)
    }
    if ($text -match '^\d+$') {
        return [Convert]::ToUInt64($text, 10)
    }
    throw "$Name must be an unsigned decimal or hexadecimal integer."
}

function Initialize-Rc2NativeReader {
    if ('RatchetHax.ReadOnlyMemory' -as [type]) { return }

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

    public static class ReadOnlyMemory
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ReadProcessMemory(
            IntPtr process,
            IntPtr baseAddress,
            [Out] byte[] buffer,
            UIntPtr size,
            out UIntPtr bytesRead);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        public static OpenResult Open(uint processId, uint desiredAccess)
        {
            IntPtr handle = OpenProcess(desiredAccess, false, processId);
            return new OpenResult {
                Handle = handle,
                ErrorCode = handle == IntPtr.Zero ? Marshal.GetLastWin32Error() : 0
            };
        }

        public static ReadResult Read(IntPtr handle, ulong address, int requestedBytes)
        {
            byte[] buffer = new byte[requestedBytes];
            UIntPtr transferred;
            bool success = ReadProcessMemory(
                handle,
                new IntPtr(unchecked((long)address)),
                buffer,
                new UIntPtr((uint)requestedBytes),
                out transferred);
            int errorCode = success ? 0 : Marshal.GetLastWin32Error();
            return new ReadResult {
                Success = success,
                BytesRead = transferred.ToUInt64(),
                ErrorCode = errorCode,
                Bytes = buffer
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

function Invoke-Rc2ReadBatch {
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [Parameter(Mandatory = $true)][object[]]$Requests,
        [Nullable[bool]]$ArchitectureIs64Bit,
        [scriptblock]$OpenAction,
        [scriptblock]$ReadAction,
        [scriptblock]$CloseAction
    )

    $is64BitProcess = [Environment]::Is64BitProcess
    if ($null -ne $ArchitectureIs64Bit) { $is64BitProcess = [bool]$ArchitectureIs64Bit }
    if (-not $is64BitProcess) {
        return [ordered]@{ status = 'unsupported_process_architecture'; process = $Process; reads = @() }
    }
    if ($Requests.Count -gt 200) {
        throw 'At most 200 candidate reads may be requested at once.'
    }
    foreach ($request in $Requests) {
        if ([string]::IsNullOrWhiteSpace([string]$request.key)) { throw 'Read request key is required.' }
        if (-not ($request.address -match '^0x[0-9a-fA-F]{1,16}$')) { throw "Invalid 64-bit address for '$($request.key)'." }
        if (-not ([string]$request.requestedBytes -match '^(1|2|4|8)$')) { throw "Invalid byte count for '$($request.key)'." }
    }

    if ($null -eq $OpenAction -or $null -eq $ReadAction -or $null -eq $CloseAction) {
        Initialize-Rc2NativeReader
        if ($null -eq $OpenAction) {
            $OpenAction = { param($targetProcessId, $access) [RatchetHax.ReadOnlyMemory]::Open([uint32]$targetProcessId, [uint32]$access) }
        }
        if ($null -eq $ReadAction) {
            $ReadAction = { param($handle, $address, $size) [RatchetHax.ReadOnlyMemory]::Read($handle, [uint64]$address, [int]$size) }
        }
        if ($null -eq $CloseAction) {
            $CloseAction = { param($handle) [RatchetHax.ReadOnlyMemory]::Close($handle) }
        }
    }

    $openResult = & $OpenAction $Process.id (Get-RpcS3ReadAccessMask)
    $hasInvalidHandle = $null -eq $openResult -or $null -eq $openResult.Handle
    if (-not $hasInvalidHandle -and $openResult.Handle -is [IntPtr]) {
        $hasInvalidHandle = $openResult.Handle -eq [IntPtr]::Zero
    }
    if ($hasInvalidHandle) {
        $errorCode = if ($null -eq $openResult) { 0 } else { [int]$openResult.ErrorCode }
        return [ordered]@{
            status = 'open_failed'
            process = $Process
            requestedAccess = 'PROCESS_VM_READ'
            errorCode = $errorCode
            reads = @()
        }
    }

    $readResults = [System.Collections.Generic.List[object]]::new()
    try {
        foreach ($request in $Requests) {
            $address = [Convert]::ToUInt64($request.address.Substring(2), 16)
            $read = & $ReadAction $openResult.Handle $address ([int]$request.requestedBytes)
            $bytes = [byte[]]$read.Bytes
            $readResults.Add([ordered]@{
                key = [string]$request.key
                address = [string]$request.address
                requestedBytes = [int]$request.requestedBytes
                success = [bool]$read.Success
                bytesRead = [uint64]$read.BytesRead
                errorCode = [int]$read.ErrorCode
                bytesBase64 = [Convert]::ToBase64String($bytes)
            })
        }
    } finally {
        & $CloseAction $openResult.Handle
    }

    [ordered]@{
        status = 'read_complete'
        process = $Process
        requestedAccess = 'PROCESS_VM_READ'
        reads = @($readResults.ToArray())
    }
}

function Export-Rc2MemorySnapshot {
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [Parameter(Mandatory = $true)][uint64]$GuestBase,
        [Parameter(Mandatory = $true)][uint64]$GuestStart,
        [Parameter(Mandatory = $true)][int]$Length,
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$ChunkBytes = 65536,
        [object]$VisibleBolts,
        [Nullable[bool]]$ArchitectureIs64Bit,
        [scriptblock]$OpenAction,
        [scriptblock]$ReadAction,
        [scriptblock]$CloseAction,
        [scriptblock]$WriteSnapshotAction,
        [scriptblock]$WriteMetadataAction
    )

    $is64BitProcess = [Environment]::Is64BitProcess
    if ($null -ne $ArchitectureIs64Bit) { $is64BitProcess = [bool]$ArchitectureIs64Bit }
    if (-not $is64BitProcess) { throw 'A 64-bit PowerShell process is required to preserve RPCS3 host addresses.' }
    if ($Length -le 0 -or $Length -gt 67108864) { throw 'Snapshot length must be between 1 byte and 64 MiB.' }
    if ($ChunkBytes -le 0 -or $ChunkBytes -gt 1048576) { throw 'Chunk size must be between 1 byte and 1 MiB.' }
    if ($GuestStart -gt [uint64]4294967295 -or ([uint64]$Length -gt ([uint64]0x100000000 - $GuestStart))) {
        throw 'Snapshot range must fit inside the 32-bit PS3 guest address space.'
    }
    $lastGuestAddress = [uint64]$GuestStart + [uint64]($Length - 1)
    if ($GuestBase -gt ([uint64]::MaxValue - $lastGuestAddress)) { throw 'Host address calculation exceeds the unsigned 64-bit range.' }
    if ($null -ne $VisibleBolts) {
        $boltText = [string]$VisibleBolts
        if ($boltText -notmatch '^\d+$') { throw 'HudBolts must be an unsigned decimal integer.' }
        try { $VisibleBolts = [Convert]::ToUInt64($boltText, 10) } catch { throw 'HudBolts must fit in an unsigned 64-bit integer.' }
        if ([uint64]$VisibleBolts -gt [uint64]([uint32]::MaxValue)) { throw 'HudBolts must fit in an unsigned 32-bit integer.' }
    }

    $snapshotPath = [IO.Path]::GetFullPath($Path)
    $metadataPath = "$snapshotPath.meta.json"
    if (Test-Path -LiteralPath $snapshotPath) { throw "Snapshot output already exists: $snapshotPath" }
    if (Test-Path -LiteralPath $metadataPath) { throw "Snapshot metadata already exists: $metadataPath" }
    $directory = [IO.Path]::GetDirectoryName($snapshotPath)
    if (-not [IO.Directory]::Exists($directory)) { throw "Snapshot directory does not exist: $directory" }

    if ($null -eq $OpenAction -or $null -eq $ReadAction -or $null -eq $CloseAction) {
        Initialize-Rc2NativeReader
        if ($null -eq $OpenAction) {
            $OpenAction = { param($targetProcessId, $access) [RatchetHax.ReadOnlyMemory]::Open([uint32]$targetProcessId, [uint32]$access) }
        }
        if ($null -eq $ReadAction) {
            $ReadAction = { param($handle, $address, $size) [RatchetHax.ReadOnlyMemory]::Read($handle, [uint64]$address, [int]$size) }
        }
        if ($null -eq $CloseAction) {
            $CloseAction = { param($handle) [RatchetHax.ReadOnlyMemory]::Close($handle) }
        }
    }
    if ($null -eq $WriteSnapshotAction) {
        $WriteSnapshotAction = {
            param($filePath, [byte[]]$bytes)
            $stream = [IO.File]::Open($filePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
    }
    if ($null -eq $WriteMetadataAction) {
        $WriteMetadataAction = {
            param($filePath, [byte[]]$bytes)
            $stream = [IO.File]::Open($filePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
        }
    }

    $captureStartedAt = [DateTime]::UtcNow.ToString('o')
    $openResult = & $OpenAction $Process.id (Get-RpcS3ReadAccessMask)
    $hasInvalidHandle = $null -eq $openResult -or $null -eq $openResult.Handle
    if (-not $hasInvalidHandle -and $openResult.Handle -is [IntPtr]) {
        $hasInvalidHandle = $openResult.Handle -eq [IntPtr]::Zero
    }
    if ($hasInvalidHandle) {
        $errorCode = if ($null -eq $openResult) { 0 } else { [int]$openResult.ErrorCode }
        throw "OpenProcess failed with Windows error $errorCode."
    }

    $buffer = New-Object byte[] $Length
    $hostStart = $GuestBase + $GuestStart
    $offset = 0
    $chunksRead = 0
    try {
        while ($offset -lt $Length) {
            $requestedBytes = [Math]::Min($ChunkBytes, $Length - $offset)
            $address = $hostStart + [uint64]$offset
            $read = & $ReadAction $openResult.Handle $address $requestedBytes
            $bytesRead = [uint64]$read.BytesRead
            $readBuffer = [byte[]]$read.Bytes
            if (-not $read.Success -or $bytesRead -ne $requestedBytes -or $readBuffer.Length -ne $requestedBytes) {
                $addressText = '0x{0:X16}' -f $address
                throw "Snapshot read failed at host ${addressText}: status=$($read.Success), bytes=$bytesRead/$requestedBytes, buffer=$($readBuffer.Length); Windows error $([int]$read.ErrorCode)."
            }
            [Array]::Copy($readBuffer, 0, $buffer, $offset, $requestedBytes)
            $offset += $requestedBytes
            $chunksRead += 1
        }
    } finally {
        & $CloseAction $openResult.Handle
    }
    $captureCompletedAt = [DateTime]::UtcNow.ToString('o')

    $shaProvider = [Security.Cryptography.SHA256]::Create()
    try {
        $sha256 = [BitConverter]::ToString($shaProvider.ComputeHash($buffer)).Replace('-', '').ToLowerInvariant()
    } finally {
        $shaProvider.Dispose()
    }

    $metadata = [ordered]@{
        schemaVersion = 1
        status = 'snapshot_complete'
        kind = 'raw-guest-memory-range'
        captureStartedAt = $captureStartedAt
        captureCompletedAt = $captureCompletedAt
        process = [ordered]@{ id = [int]$Process.id; name = [string]$Process.name; path = $Process.path }
        requestedAccess = 'PROCESS_VM_READ'
        guestBase = ('0x{0:X16}' -f $GuestBase)
        guestStart = ('0x{0:X8}' -f $GuestStart)
        hostStart = ('0x{0:X16}' -f $hostStart)
        lengthBytes = $Length
        chunkBytes = $ChunkBytes
        chunksRead = $chunksRead
        bytesRead = $offset
        visibleBolts = $VisibleBolts
        sha256 = $sha256
        snapshotFile = $snapshotPath
    }

    $metadataJson = $metadata | ConvertTo-Json -Depth 6
    $temporaryId = [Guid]::NewGuid().ToString('N')
    $temporarySnapshotPath = "$snapshotPath.$temporaryId.partial"
    $temporaryMetadataPath = "$metadataPath.$temporaryId.partial"
    $metadataBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($metadataJson)
    $snapshotMoved = $false
    $metadataMoved = $false
    try {
        & $WriteSnapshotAction $temporarySnapshotPath $buffer
        & $WriteMetadataAction $temporaryMetadataPath $metadataBytes
        [IO.File]::Move($temporarySnapshotPath, $snapshotPath)
        $snapshotMoved = $true
        [IO.File]::Move($temporaryMetadataPath, $metadataPath)
        $metadataMoved = $true
    } catch {
        if ($snapshotMoved -and [IO.File]::Exists($snapshotPath)) { [IO.File]::Delete($snapshotPath) }
        if ($metadataMoved -and [IO.File]::Exists($metadataPath)) { [IO.File]::Delete($metadataPath) }
        throw
    } finally {
        if ([IO.File]::Exists($temporarySnapshotPath)) { [IO.File]::Delete($temporarySnapshotPath) }
        if ([IO.File]::Exists($temporaryMetadataPath)) { [IO.File]::Delete($temporaryMetadataPath) }
    }

    $metadata
}

if (-not $LibraryOnly) {
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $processes = @(Get-RpcS3Processes)
        $selection = Resolve-RpcS3Process -Processes $processes -RequestedProcessId $ProcessId
        if ($selection.status -ne 'selected') {
            $selection | ConvertTo-Json -Depth 8 -Compress
            exit 0
        }
        if ($Snapshot) {
            if ([string]::IsNullOrWhiteSpace($GuestBase) -or [string]::IsNullOrWhiteSpace($GuestStart) -or $SnapshotLength -le 0 -or [string]::IsNullOrWhiteSpace($SnapshotPath)) {
                throw 'Snapshot mode requires -GuestBase, -GuestStart, -SnapshotLength, and -SnapshotPath.'
            }
            $result = Export-Rc2MemorySnapshot -Process $selection.process `
                -GuestBase (ConvertFrom-Rc2Unsigned64 -Value $GuestBase -Name 'GuestBase') `
                -GuestStart (ConvertFrom-Rc2Unsigned64 -Value $GuestStart -Name 'GuestStart') `
                -Length $SnapshotLength -ChunkBytes $ChunkSize -Path $SnapshotPath -VisibleBolts $HudBolts
        } else {
            if ([string]::IsNullOrWhiteSpace($RequestsBase64)) { throw 'RequestsBase64 is required.' }
            $requestEnvelope = ConvertFrom-Rc2RequestsBase64 -RequestsBase64 $RequestsBase64
            $requests = @($requestEnvelope.requests)
            $result = Invoke-Rc2ReadBatch -Process $selection.process -Requests $requests
        }
        $result | ConvertTo-Json -Depth 10 -Compress
    } catch {
        [ordered]@{ status = 'probe_error'; message = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
        exit 1
    }
}

[CmdletBinding()]
param(
    [switch]$LibraryOnly,
    [Nullable[int]]$ProcessId,
    [string]$RequestsJson
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

function Get-RpcS3ReadAccessMask {
    # PROCESS_VM_READ only. The probe never requests write or operation rights.
    [uint32]0x0010
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
            $OpenAction = { param($pid, $access) [RatchetHax.ReadOnlyMemory]::Open([uint32]$pid, [uint32]$access) }
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

if (-not $LibraryOnly) {
    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $processes = Get-RpcS3Processes
        $selection = Resolve-RpcS3Process -Processes $processes -RequestedProcessId $ProcessId
        if ($selection.status -ne 'selected') {
            $selection | ConvertTo-Json -Depth 8 -Compress
            exit 0
        }
        if ([string]::IsNullOrWhiteSpace($RequestsJson)) { throw 'RequestsJson is required.' }

        $requests = @($RequestsJson | ConvertFrom-Json)
        $result = Invoke-Rc2ReadBatch -Process $selection.process -Requests $requests
        $result | ConvertTo-Json -Depth 10 -Compress
    } catch {
        [ordered]@{ status = 'probe_error'; message = $_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
        exit 1
    }
}

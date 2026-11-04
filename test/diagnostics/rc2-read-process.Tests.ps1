$probePath = Join-Path $PSScriptRoot '..\..\diagnostics\rc2-read-process.ps1'
. $probePath -LibraryOnly

Describe 'Resolve-RpcS3Process' {
    It 'selects the only RPCS3 process automatically' {
        $processes = @(@{ id = 41; name = 'rpcs3'; path = 'C:\RPCS3\rpcs3.exe' })

        $result = Resolve-RpcS3Process -Processes $processes -RequestedProcessId $null

        $result.status | Should Be 'selected'
        $result.process.id | Should Be 41
    }

    It 'requires an explicit PID when multiple RPCS3 processes are present' {
        $processes = @(
            @{ id = 41; name = 'rpcs3'; path = $null },
            @{ id = 42; name = 'rpcs3'; path = $null }
        )

        $result = Resolve-RpcS3Process -Processes $processes -RequestedProcessId $null

        $result.status | Should Be 'selection_required'
        $result.processes.Count | Should Be 2
    }

    It 'selects the requested PID from multiple RPCS3 processes' {
        $processes = @(
            @{ id = 41; name = 'rpcs3'; path = $null },
            @{ id = 42; name = 'rpcs3'; path = $null }
        )

        $result = Resolve-RpcS3Process -Processes $processes -RequestedProcessId 42

        $result.status | Should Be 'selected'
        $result.process.id | Should Be 42
    }

    It 'reports no-process and unknown-PID states without selecting another process' {
        (Resolve-RpcS3Process -Processes @() -RequestedProcessId $null).status | Should Be 'no_rpcs3_process'
        (Resolve-RpcS3Process -Processes @() -RequestedProcessId 99).status | Should Be 'process_not_found'
    }
}

Describe 'ConvertFrom-Rc2RequestsBase64' {
    It 'decodes multiple request lines into individual objects' {
        $jsonLines = '{"key":"bolts","address":"0x0000000301329a90","requestedBytes":4}' + "`n" + `
            '{"key":"health","address":"0x00000003014816ac","requestedBytes":4}'
        $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($jsonLines))

        $result = ConvertFrom-Rc2RequestsBase64 -RequestsBase64 $encoded

        $result.requests.Count | Should Be 2
        $result.requests[0].key | Should Be 'bolts'
        $result.requests[0].address | Should Be '0x0000000301329a90'
        $result.requests[1].key | Should Be 'health'
    }
}

Describe 'Invoke-Rc2ReadBatch' {
    It 'compiles the Win32 reader declarations without opening a process' {
        Initialize-Rc2NativeReader

        ('RatchetHax.ReadOnlyMemory' -as [type]) | Should Not Be $null
    }

    It 'refuses to read from a 32-bit PowerShell process' {
        $script:openCalled = $false
        $open = { $script:openCalled = $true }

        $result = Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0x0000000301329a90'; requestedBytes = 4 }) `
            -ArchitectureIs64Bit $false -OpenAction $open

        $result.status | Should Be 'unsupported_process_architecture'
        $script:openCalled | Should Be $false
    }

    It 'requests only PROCESS_VM_READ, preserves the candidate address, and closes the handle' {
        $script:ObservedAccess = 0
        $script:ObservedAddress = [uint64]0
        $script:ClosedHandle = $false
        $open = {
            param($processId, $access)
            $script:ObservedAccess = $access
            [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 }
        }
        $read = {
            param($handle, $address, $size)
            $script:ObservedAddress = $address
            [pscustomobject]@{
                Success = $true
                BytesRead = [uint64]$size
                ErrorCode = 0
                Bytes = [byte[]](0..($size - 1))
            }
        }
        $close = {
            param($handle)
            $script:ClosedHandle = $true
        }
        $requests = @(@{ key = 'bolts'; address = '0x0000000301329a90'; requestedBytes = 4 })

        $result = Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } -Requests $requests `
            -OpenAction $open -ReadAction $read -CloseAction $close

        $script:ObservedAccess | Should Be 16
        $script:ObservedAddress | Should Be ([uint64]12904995472)
        $script:ClosedHandle | Should Be $true
        $result.status | Should Be 'read_complete'
        $result.requestedAccess | Should Be 'PROCESS_VM_READ'
        $result.reads[0].address | Should Be '0x0000000301329a90'
        $result.reads[0].bytesRead | Should Be 4
        $result.reads[0].bytesBase64 | Should Be 'AAECAw=='
    }

    It 'preserves a failed open error and does not attempt reads' {
        $script:readCalled = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = [IntPtr]::Zero; ErrorCode = 5 } }
        $read = { $script:readCalled = $true }
        $close = { }

        $result = Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0x0000000301329a90'; requestedBytes = 4 }) `
            -OpenAction $open -ReadAction $read -CloseAction $close

        $result.status | Should Be 'open_failed'
        $result.errorCode | Should Be 5
        $result.reads.Count | Should Be 0
        $script:readCalled | Should Be $false
    }

    It 'returns partial bytes and Win32 errors without interpreting their contents' {
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{
                Success = $false
                BytesRead = [uint64]2
                ErrorCode = 299
                Bytes = [byte[]](0, 0, 0, 0)
            }
        }
        $close = { }

        $result = Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0x0000000301329a90'; requestedBytes = 4 }) `
            -OpenAction $open -ReadAction $read -CloseAction $close

        $result.reads[0].success | Should Be $false
        $result.reads[0].bytesRead | Should Be 2
        $result.reads[0].errorCode | Should Be 299
        $result.reads[0].bytesBase64 | Should Be 'AAAAAA=='
    }

    It 'closes the process handle when an individual read throws' {
        $script:ClosedAfterFailure = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
        $read = { throw 'mock read failure' }
        $close = { param($handle) $script:ClosedAfterFailure = $true }

        { Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0x0000000301329a90'; requestedBytes = 4 }) `
            -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'mock read failure'
        $script:ClosedAfterFailure | Should Be $true
    }

    It 'rejects malformed addresses, byte counts, and oversized batches before opening a process' {
        $script:openCalls = 0
        $open = { $script:openCalls += 1; [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
        $read = { }
        $close = { }

        { Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0xNOTHEX'; requestedBytes = 4 }) `
            -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'Invalid 64-bit address'
        { Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(@{ key = 'bolts'; address = '0x1'; requestedBytes = 3 }) `
            -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'Invalid byte count'
        { Invoke-Rc2ReadBatch -Process @{ id = 42; name = 'rpcs3' } `
            -Requests @(1..201 | ForEach-Object { @{ key = "field$_"; address = '0x1'; requestedBytes = 1 } }) `
            -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'At most 200'
        $script:openCalls | Should Be 0
    }
}

Describe 'Export-Rc2MemorySnapshot' {
    It 'reads every chunk at an exact 64-bit host address using read permission only' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'baseline.bin'
        $script:SnapshotAccess = 0
        $script:SnapshotAddresses = [System.Collections.Generic.List[uint64]]::new()
        $script:SnapshotClosed = $false
        $open = {
            param($processId, $access)
            $script:SnapshotAccess = $access
            [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 }
        }
        $read = {
            param($handle, $address, $size)
            $script:SnapshotAddresses.Add([uint64]$address)
            $bytes = New-Object byte[] $size
            for ($index = 0; $index -lt $size; $index += 1) {
                $bytes[$index] = [byte](($address + [uint64]$index) -band 0xff)
            }
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = $bytes }
        }
        $close = { param($handle) $script:SnapshotClosed = $true }

        try {
            $result = Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = 'C:\RPCS3\rpcs3.exe' } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 10 -ChunkBytes 4 `
                -Path $snapshotPath -VisibleBolts 244012 -OpenAction $open -ReadAction $read -CloseAction $close

            $script:SnapshotAccess | Should Be 16
            $script:SnapshotAddresses.Count | Should Be 3
            $script:SnapshotAddresses[0] | Should Be ([uint64]0x3012E0000)
            $script:SnapshotAddresses[1] | Should Be ([uint64]0x3012E0004)
            $script:SnapshotAddresses[2] | Should Be ([uint64]0x3012E0008)
            $script:SnapshotClosed | Should Be $true
            $result.status | Should Be 'snapshot_complete'
            $result.guestBase | Should Be '0x0000000300000000'
            $result.guestStart | Should Be '0x012E0000'
            $result.hostStart | Should Be '0x00000003012E0000'
            $result.visibleBolts | Should Be 244012
            $result.bytesRead | Should Be 10
            (Test-Path -LiteralPath $snapshotPath) | Should Be $true
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $true
            ([IO.File]::ReadAllBytes($snapshotPath).Length) | Should Be 10
            ((Get-Content -Raw "$snapshotPath.meta.json" | ConvertFrom-Json).sha256.Length) | Should Be 64
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'does not save a partial snapshot and closes the process handle' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'incomplete.bin'
        $script:SnapshotReadCalls = 0
        $script:SnapshotClosedAfterFailure = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            $script:SnapshotReadCalls += 1
            if ($script:SnapshotReadCalls -eq 2) {
                [pscustomobject]@{ Success = $false; BytesRead = [uint64]2; ErrorCode = 299; Bytes = [byte[]](1,2,3,4) }
            } else {
                [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = [byte[]](1..$size) }
            }
        }
        $close = { param($handle) $script:SnapshotClosedAfterFailure = $true }

        try {
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = $null } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 8 -ChunkBytes 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'Snapshot read failed'

            $script:SnapshotClosedAfterFailure | Should Be $true
            (Test-Path -LiteralPath $snapshotPath) | Should Be $false
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $false
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'rejects a successful API call that reports fewer bytes than requested' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'short-success.bin'
        $script:SnapshotClosedAfterShortSuccess = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]($size - 1); ErrorCode = 0; Bytes = [byte[]](1..$size) }
        }
        $close = { param($handle) $script:SnapshotClosedAfterShortSuccess = $true }

        try {
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = $null } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 -ChunkBytes 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'bytes=3/4'

            $script:SnapshotClosedAfterShortSuccess | Should Be $true
            (Test-Path -LiteralPath $snapshotPath) | Should Be $false
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $false
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'rejects a successful full-count read with a short result buffer' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'short-buffer.bin'
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = [byte[]](1..($size - 1)) }
        }
        $close = { }

        try {
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = $null } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 -ChunkBytes 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'buffer=3'
            (Test-Path -LiteralPath $snapshotPath) | Should Be $false
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $false
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'cleans up a partially written binary and sidecar after output failures' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'write-failure.bin'
        $script:TemporarySnapshotPath = $null
        $script:TemporaryMetadataPath = $null
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = [byte[]](1..$size) }
        }
        $close = { }
        $writeSnapshot = {
            param($filePath, $bytes)
            $script:TemporarySnapshotPath = $filePath
            [IO.File]::WriteAllBytes($filePath, [byte[]]$bytes)
            throw 'mock metadata failure'
        }
        $writeMetadata = {
            param($filePath, $bytes)
            $script:TemporaryMetadataPath = $filePath
            [IO.File]::WriteAllBytes($filePath, [byte[]]$bytes)
            throw 'mock metadata failure'
        }

        try {
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = $null } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 -ChunkBytes 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close `
                -WriteSnapshotAction $writeSnapshot -WriteMetadataAction $writeMetadata } | Should Throw 'mock metadata failure'

            (Test-Path -LiteralPath $snapshotPath) | Should Be $false
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $false
            (Test-Path -LiteralPath $script:TemporarySnapshotPath) | Should Be $false
            $script:TemporaryMetadataPath | Should Be $null
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'cleans up the binary temporary if metadata writing fails after creating it' {
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'metadata-failure.bin'
        $script:TemporarySnapshotPath = $null
        $script:TemporaryMetadataPath = $null
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'snapshot-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = [byte[]](1..$size) }
        }
        $close = { }
        $writeSnapshot = {
            param($filePath, $bytes)
            $script:TemporarySnapshotPath = $filePath
            [IO.File]::WriteAllBytes($filePath, [byte[]]$bytes)
        }
        $writeMetadata = {
            param($filePath, $bytes)
            $script:TemporaryMetadataPath = $filePath
            [IO.File]::WriteAllBytes($filePath, [byte[]]$bytes)
            throw 'mock metadata failure'
        }

        try {
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3'; path = $null } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 -ChunkBytes 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close `
                -WriteSnapshotAction $writeSnapshot -WriteMetadataAction $writeMetadata } | Should Throw 'mock metadata failure'

            (Test-Path -LiteralPath $snapshotPath) | Should Be $false
            (Test-Path -LiteralPath "$snapshotPath.meta.json") | Should Be $false
            (Test-Path -LiteralPath $script:TemporarySnapshotPath) | Should Be $false
            (Test-Path -LiteralPath $script:TemporaryMetadataPath) | Should Be $false
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }

    It 'rejects unsupported architectures, invalid guest ranges, and existing outputs before opening' {
        $openCalled = $false
        $open = { $script:SnapshotOpenCalled = $true }
        $read = { }
        $close = { }
        $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('rc2-snapshot-' + [Guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($tempDirectory)
        $snapshotPath = Join-Path $tempDirectory 'existing.bin'
        [IO.File]::WriteAllBytes($snapshotPath, [byte[]](1))

        try {
            $script:SnapshotOpenCalled = $false
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3' } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 `
                -Path $snapshotPath -ArchitectureIs64Bit $false -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw '64-bit PowerShell process'
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3' } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]4294967295) -Length 4 `
                -Path (Join-Path $tempDirectory 'out-of-range.bin') -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw '32-bit PS3 guest address space'
            { Export-Rc2MemorySnapshot -Process @{ id = 42; name = 'rpcs3' } `
                -GuestBase ([uint64]0x300000000) -GuestStart ([uint64]0x012E0000) -Length 4 `
                -Path $snapshotPath -OpenAction $open -ReadAction $read -CloseAction $close } | Should Throw 'already exists'
            $script:SnapshotOpenCalled | Should Be $false
        } finally {
            if (Test-Path -LiteralPath $tempDirectory) { Remove-Item -LiteralPath $tempDirectory -Recurse -Force }
        }
    }
}

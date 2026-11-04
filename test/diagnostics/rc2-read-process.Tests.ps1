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

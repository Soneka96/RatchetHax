. "$PSScriptRoot\..\..\scripts\collection-bolts.ps1" -LibraryOnly

Describe 'Collection bolt memory backend' {
    It 'reads four complete big-endian bytes at the exact 64-bit address with read access only' {
        $script:ObservedAccess = 0
        $script:ObservedAddress = [uint64]0
        $script:Closed = $false
        $open = {
            param($processId, $access)
            $script:ObservedAccess = [uint32]$access
            [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 }
        }
        $read = {
            param($handle, $address, $size)
            $script:ObservedAddress = [uint64]$address
            [pscustomobject]@{
                Success = $true
                BytesRead = [uint64]$size
                ErrorCode = 0
                Bytes = [byte[]](0x00, 0x01, 0x84, 0x7D)
            }
        }
        $close = { param($handle) $script:Closed = $true }

        $result = Invoke-CollectionBoltMemory -Mode read -ProcessId 15324 `
            -Address '0x00000003009bc3a0' -OpenAction $open -ReadAction $read -CloseAction $close

        $result.status | Should Be 'read_complete'
        $result.value | Should Be 99453
        $script:ObservedAccess | Should Be 16
        $script:ObservedAddress | Should Be ([uint64]0x3009BC3A0)
        $script:Closed | Should Be $true
    }

    It 'writes only four big-endian bytes and verifies the full read-back' {
        $script:CurrentValue = [uint32]99453
        $script:ObservedAccess = 0
        $script:ObservedAddress = [uint64]0
        $script:ObservedBytes = $null
        $script:Closed = $false
        $open = {
            param($processId, $access)
            $script:ObservedAccess = [uint32]$access
            [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 }
        }
        $read = {
            param($handle, $address, $size)
            $bytes = ConvertTo-CollectionBigEndianUInt32 -Value $script:CurrentValue
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]$size; ErrorCode = 0; Bytes = $bytes }
        }
        $write = {
            param($handle, $address, $bytes)
            $script:ObservedAddress = [uint64]$address
            $script:ObservedBytes = [byte[]]$bytes
            $script:CurrentValue = ConvertFrom-CollectionBigEndianUInt32 -Bytes $bytes
            [pscustomobject]@{ Success = $true; BytesWritten = [uint64]$bytes.Length; ErrorCode = 0 }
        }
        $close = { param($handle) $script:Closed = $true }

        $result = Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 `
            -Address '0x00000003009bc3a0' -Value '105055' `
            -OpenAction $open -ReadAction $read -WriteAction $write -CloseAction $close

        $result.status | Should Be 'write_complete'
        $result.beforeValue | Should Be 99453
        $result.afterValue | Should Be 105055
        $script:ObservedAccess | Should Be 56
        $script:ObservedAddress | Should Be ([uint64]0x3009BC3A0)
        [Convert]::ToHexString($script:ObservedBytes) | Should Be '00019A5F'
        $script:Closed | Should Be $true
    }

    It 'blocks writes when the initial read fails or is partial' {
        foreach ($readResponse in @(
            [pscustomobject]@{ Success = $false; BytesRead = [uint64]0; ErrorCode = 5; Bytes = [byte[]](0,0,0,0) },
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]2; ErrorCode = 0; Bytes = [byte[]](0,0,0,0) }
        )) {
            $script:WriteCalled = $false
            $script:ClosedAfterReadFailure = $false
            $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
            $read = { param($handle, $address, $size) $readResponse }
            $write = { $script:WriteCalled = $true }
            $close = { param($handle) $script:ClosedAfterReadFailure = $true }

            $result = Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 `
                -Address '0x00000003009bc3a0' -Value '105055' `
                -OpenAction $open -ReadAction $read -WriteAction $write -CloseAction $close

            (@('read_failed', 'read_partial') -contains $result.status) | Should Be $true
            $script:WriteCalled | Should Be $false
            $script:ClosedAfterReadFailure | Should Be $true
        }
    }

    It 'reports an open failure without attempting reads' {
        $script:ReadCalled = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = [IntPtr]::Zero; ErrorCode = 5 } }
        $read = { $script:ReadCalled = $true }
        $close = { }

        $result = Invoke-CollectionBoltMemory -Mode read -ProcessId 15324 `
            -Address '0x00000003009bc3a0' -OpenAction $open -ReadAction $read -CloseAction $close

        $result.status | Should Be 'open_failed'
        $result.errorCode | Should Be 5
        $script:ReadCalled | Should Be $false
    }

    It 'does not decode failed or partial reads in read mode' {
        foreach ($readResponse in @(
            [pscustomobject]@{ Success = $false; BytesRead = [uint64]0; ErrorCode = 299; Bytes = [byte[]](0,0,0,7) },
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]2; ErrorCode = 0; Bytes = [byte[]](0,0,0,7) }
        )) {
            $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
            $read = { param($handle, $address, $size) $readResponse }
            $close = { }

            $result = Invoke-CollectionBoltMemory -Mode read -ProcessId 15324 `
                -Address '0x00000003009bc3a0' -OpenAction $open -ReadAction $read -CloseAction $close

            (@('read_failed', 'read_partial') -contains $result.status) | Should Be $true
            $result.Contains('value') | Should Be $false
        }
    }

    It 'reports native write and read-back failures instead of claiming success' {
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
        $read = {
            param($handle, $address, $size)
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]4; ErrorCode = 0; Bytes = [byte[]](0,0,0,1) }
        }
        $writeFailure = {
            param($handle, $address, $bytes)
            [pscustomobject]@{ Success = $false; BytesWritten = [uint64]0; ErrorCode = 5 }
        }
        $writeSuccess = {
            param($handle, $address, $bytes)
            [pscustomobject]@{ Success = $true; BytesWritten = [uint64]4; ErrorCode = 0 }
        }
        $reads = 0
        $mismatchRead = {
            param($handle, $address, $size)
            $script:reads += 1
            $value = if ($script:reads -eq 1) { [byte[]](0,0,0,1) } else { [byte[]](0,0,0,2) }
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]4; ErrorCode = 0; Bytes = $value }
        }
        $close = { }

        $failed = Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 `
            -Address '0x00000003009bc3a0' -Value '105055' `
            -OpenAction $open -ReadAction $read -WriteAction $writeFailure -CloseAction $close
        $verifyFailed = Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 `
            -Address '0x00000003009bc3a0' -Value '105055' `
            -OpenAction $open -ReadAction $mismatchRead -WriteAction $writeSuccess -CloseAction $close

        $failed.status | Should Be 'write_failed'
        $failed.errorCode | Should Be 5
        $verifyFailed.status | Should Be 'write_verify_failed'
        $verifyFailed.afterValue | Should Be 2
    }

    It 'reports failed and partial post-write reads as verification failures' {
        foreach ($afterRead in @(
            [pscustomobject]@{ Success = $false; BytesRead = [uint64]0; ErrorCode = 299; Bytes = [byte[]](0,0,0,0) },
            [pscustomobject]@{ Success = $true; BytesRead = [uint64]2; ErrorCode = 0; Bytes = [byte[]](0,0,0,0) }
        )) {
            $script:ReadCount = 0
            $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
            $read = {
                param($handle, $address, $size)
                $script:ReadCount += 1
                if ($script:ReadCount -eq 1) {
                    [pscustomobject]@{ Success = $true; BytesRead = [uint64]4; ErrorCode = 0; Bytes = [byte[]](0,0,0,1) }
                } else {
                    $afterRead
                }
            }
            $write = { param($handle, $address, $bytes) [pscustomobject]@{ Success = $true; BytesWritten = [uint64]4; ErrorCode = 0 } }
            $close = { }

            $result = Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 `
                -Address '0x00000003009bc3a0' -Value '105055' `
                -OpenAction $open -ReadAction $read -WriteAction $write -CloseAction $close

            $result.status | Should Be 'write_verify_failed'
            (@('read_failed', 'read_partial') -contains $result.afterStatus) | Should Be $true
        }
    }

    It 'closes an opened process handle when a read or write callback throws' {
        $script:ClosedAfterReadThrow = $false
        $open = { param($processId, $access) [pscustomobject]@{ Handle = 'test-handle'; ErrorCode = 0 } }
        $readThrows = { throw 'mock read failure' }
        $closeAfterRead = { param($handle) $script:ClosedAfterReadThrow = $true }
        { Invoke-CollectionBoltMemory -Mode read -ProcessId 15324 -Address '0x00000003009bc3a0' `
            -OpenAction $open -ReadAction $readThrows -CloseAction $closeAfterRead } | Should Throw 'mock read failure'
        $script:ClosedAfterReadThrow | Should Be $true

        $script:ClosedAfterWriteThrow = $false
        $read = { param($handle, $address, $size) [pscustomobject]@{ Success = $true; BytesRead = [uint64]4; ErrorCode = 0; Bytes = [byte[]](0,0,0,1) } }
        $writeThrows = { throw 'mock write failure' }
        $closeAfterWrite = { param($handle) $script:ClosedAfterWriteThrow = $true }
        { Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 -Address '0x00000003009bc3a0' `
            -Value '105055' -OpenAction $open -ReadAction $read -WriteAction $writeThrows -CloseAction $closeAfterWrite } | Should Throw 'mock write failure'
        $script:ClosedAfterWriteThrow | Should Be $true
    }

    It 'rejects invalid addresses and bolt counts before opening a process' {
        $script:OpenCalled = $false
        $open = { $script:OpenCalled = $true }
        $read = { }
        $write = { }
        $close = { }

        { Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 -Address 'not-an-address' `
            -Value '105055' -OpenAction $open -ReadAction $read -WriteAction $write -CloseAction $close } |
            Should Throw 'Invalid 64-bit address'
        { Invoke-CollectionBoltMemory -Mode write -ProcessId 15324 -Address '0x00000003009bc3a0' `
            -Value '-1' -OpenAction $open -ReadAction $read -WriteAction $write -CloseAction $close } |
            Should Throw 'unsigned decimal integer'
        $script:OpenCalled | Should Be $false
    }

    It 'rejects a 32-bit PowerShell process before opening the game process' {
        $script:OpenCalled = $false
        $open = { $script:OpenCalled = $true }
        { Invoke-CollectionBoltMemory -Mode read -ProcessId 15324 -Address '0x00000003009bc3a0' `
            -ArchitectureIs64Bit $false -OpenAction $open } | Should Throw '64-bit PowerShell process'
        $script:OpenCalled | Should Be $false
    }
}

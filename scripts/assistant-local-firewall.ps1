[CmdletBinding(SupportsShouldProcess=$true)]
param([Parameter(Mandatory=$true)][ValidateSet('Enable','Disable')][string]$Action)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stateRoot = Join-Path $projectRoot 'backend\.pytest_cache\assistant-local-android'
$stateFile = Join-Path $stateRoot 'firewall-state.json'
$ruleName = 'Contexify-Assistant-Local-HTTPS'
$guardNames = @(($ruleName + '-OtherLocalAddresses'), ($ruleName + '-OtherPeers'))
$hotspotAddress = '192.168.137.1'
# Use nonzero IPv6 prefixes and keep IPv4 provider ranges off the
# unspecified and broadcast endpoints.
$outsideLocalAddresses = @('0.0.0.1-192.168.137.0','192.168.137.2-255.255.255.254','::/1','8000::/1')
$outsidePeerAddresses = @('0.0.0.1-192.168.136.255','192.168.138.0-255.255.255.254')
$otherPorts = @('1-442','444-65535')
$python = Join-Path $projectRoot 'backend\venv\Scripts\python.exe'

function Get-LocalRule([string]$Name) {
    Get-NetFirewallRule -PolicyStore PersistentStore -Name $Name -ErrorAction SilentlyContinue
}

function Assert-Administrator {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Open PowerShell as Administrator to apply this local firewall change. -WhatIf needs no elevation.'
    }
}

function Restore-BlockPorts($Snapshot) {
    foreach ($entry in $Snapshot.BlockRules) {
        $rule = Get-LocalRule $entry.Name
        if (!$rule -or [string]$rule.Action -ne 'Block' -or [string]$rule.Direction -ne 'Inbound' -or
            [string]$rule.Profile -ne 'Public' -or
            ($rule | Get-NetFirewallApplicationFilter).Program -ine $Snapshot.Program) {
            throw 'A saved Python rule changed independently; refusing to overwrite it.'
        }
        $filter = $rule | Get-NetFirewallPortFilter
        $ports = (@($filter.LocalPort) | Sort-Object) -join ','
        if ($ports -eq 'Any') { continue }
        if ([string]$filter.Protocol -ne 'TCP' -or $ports -ne (($otherPorts | Sort-Object) -join ',')) {
            throw 'A saved Python port filter changed independently; refusing to overwrite it.'
        }
        $rule | Set-NetFirewallRule -LocalPort Any
    }
}

function Remove-TestGuards($Snapshot) {
    foreach ($name in $guardNames) {
        $guard = Get-LocalRule $name
        if (!$guard) { continue }
        if ([string]$guard.Action -ne 'Block' -or [string]$guard.Profile -ne 'Public' -or
            ($guard | Get-NetFirewallApplicationFilter).Program -ine $Snapshot.Program -or
            ($guard | Get-NetFirewallPortFilter).LocalPort -ne '443') {
            throw 'A test guard rule changed independently; refusing to overwrite it.'
        }
        $guard | Remove-NetFirewallRule
    }
}

if ($Action -eq 'Disable') {
    if (!(Test-Path -LiteralPath $stateFile)) { throw 'No saved test-firewall change exists; nothing was altered.' }
    $snapshot = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    if ($snapshot.Version -ne 1 -or $snapshot.RuleName -ne $ruleName) { throw 'Unrecognized firewall state.' }
    if (!$PSCmdlet.ShouldProcess('PC hotspot test HTTPS exception', 'Remove allow rule and restore saved Python TCP blocks')) { return }
    Assert-Administrator
    # Remove access first. Preserve the snapshot if a later restoration needs attention.
    $existing = Get-LocalRule $ruleName
    if ($existing) {
        if (($existing | Get-NetFirewallApplicationFilter).Program -ine $snapshot.Program -or
            ($existing | Get-NetFirewallPortFilter).LocalPort -ne '443' -or
            ($existing | Get-NetFirewallAddressFilter).LocalAddress -ne $hotspotAddress) {
            throw 'The test allow rule changed independently; refusing to remove it.'
        }
        $existing | Remove-NetFirewallRule
    }
    Restore-BlockPorts $snapshot
    Remove-TestGuards $snapshot
    Remove-Item -LiteralPath $stateFile
    Write-Output 'Removed the test exception and restored the original Python TCP block scope.'
    return
}

if (!(Test-Path -LiteralPath (Join-Path $stateRoot 'backend-192-168-137-1\assistant-local-test-state'))) {
    throw 'The isolated hotspot backend has not been prepared.'
}
if ((Test-Path -LiteralPath $stateFile) -or (Get-LocalRule $ruleName)) {
    throw 'A test-firewall change already exists. Use -Action Disable to restore it before enabling again.'
}
foreach ($name in $guardNames) {
    if (Get-LocalRule $name) { throw 'A test guard already exists without its state; inspect it before proceeding.' }
}
# Windows Store/venv launchers can report an alias rather than the running image.
# Firewall application filters must match the actual native executable path.
$program = & $python -I -c 'import ctypes; path=ctypes.create_unicode_buffer(32768); assert ctypes.windll.kernel32.GetModuleFileNameW(None,path,len(path)); print(path.value)'
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $program -PathType Leaf)) { throw 'Cannot resolve the backend Python executable.' }
$interface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $hotspotAddress -ErrorAction Stop)
if ($interface.Count -ne 1) { throw 'The expected PC hotspot interface is unavailable.' }
foreach ($profile in Get-NetFirewallProfile -PolicyStore ActiveStore) {
    if ([string]$profile.Enabled -ne 'True' -or [string]$profile.DefaultInboundAction -ne 'Block' -or
        [string]$profile.AllowLocalFirewallRules -eq 'False') {
        throw 'Firewall defaults differ from the reviewed setup; refusing to widen access.'
    }
}
$blocks = @(Get-NetFirewallRule -PolicyStore PersistentStore -Enabled True -Direction Inbound -Action Block |
    Where-Object { [string]$_.Profile -eq 'Public' -and
        ($_ | Get-NetFirewallApplicationFilter).Program -ieq $program } |
    Where-Object { $port = $_ | Get-NetFirewallPortFilter; [string]$port.Protocol -eq 'TCP' -and [string]$port.LocalPort -eq 'Any' })
foreach ($block in $blocks) {
    $address = $block | Get-NetFirewallAddressFilter
    if ([string]$address.LocalAddress -ne 'Any' -or [string]$address.RemoteAddress -ne 'Any') {
        throw 'A matching block has custom addresses; refusing to replace its scope.'
    }
}
$snapshot = [pscustomobject]@{Version=1;RuleName=$ruleName;Program=$program;BlockRules=@($blocks | ForEach-Object { [pscustomobject]@{Name=$_.Name} })}
Write-Output ('Reviewed scope: TCP 443, local ' + $hotspotAddress + ', remote 192.168.137.0/24, interface ' + $interface[0].InterfaceAlias + ', backend Python only.')
Write-Output ('Public Python TCP block rules requiring a port exception: ' + $blocks.Count)
if (!$PSCmdlet.ShouldProcess('PC hotspot test HTTPS endpoint only', 'Save rollback state, exempt TCP 443 from matching Python blocks and add restricted allow rule')) { return }
Assert-Administrator
$snapshot | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
try {
    if ($blocks.Count) {
        # Preserve the explicit public-network block everywhere outside the exact
        # hotspot exception, even if an unrelated allow rule already exists.
        New-NetFirewallRule -PolicyStore PersistentStore -Name $guardNames[0] -DisplayName 'Contexify test guard: Python HTTPS outside hotspot' `
            -Direction Inbound -Action Block -Enabled True -Profile Public -Program $program -Protocol TCP -LocalPort 443 `
            -LocalAddress $outsideLocalAddresses | Out-Null
        New-NetFirewallRule -PolicyStore PersistentStore -Name $guardNames[1] -DisplayName 'Contexify test guard: Python HTTPS outside hotspot peers' `
            -Direction Inbound -Action Block -Enabled True -Profile Public -Program $program -Protocol TCP -LocalPort 443 `
            -LocalAddress $hotspotAddress -RemoteAddress $outsidePeerAddresses | Out-Null
    }
    foreach ($block in $blocks) { $block | Set-NetFirewallRule -LocalPort $otherPorts }
    New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName 'Contexify local assistant HTTPS test (hotspot only)' `
        -Description 'Temporary isolated assistant test; remove using scripts/assistant-local-firewall.ps1 -Action Disable.' `
        -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $program -Protocol TCP -LocalPort 443 `
        -LocalAddress $hotspotAddress -RemoteAddress '192.168.137.0/24' -InterfaceAlias $interface[0].InterfaceAlias | Out-Null
} catch {
    $failure = $_
    $owned = Get-LocalRule $ruleName
    if ($owned) { $owned | Remove-NetFirewallRule }
    Restore-BlockPorts $snapshot
    Remove-TestGuards $snapshot
    Remove-Item -LiteralPath $stateFile
    throw $failure
}
Write-Output 'Enabled only hotspot-to-test-backend HTTPS. Firewall stays enabled; production and the APK are unchanged.'

param([int]$Port = 3109, [switch]$Confirm)

$ErrorActionPreference = 'Stop'
if (-not $Confirm) {
    throw 'Run again with -Confirm to generate and enable the local DISPATCH_API_KEY.'
}

$key = [Environment]::GetEnvironmentVariable('DISPATCH_API_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
    [Environment]::SetEnvironmentVariable('DISPATCH_API_KEY', $key, 'User')
}
$env:DISPATCH_API_KEY = $key
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { Stop-Process -Id $listener.OwningProcess }
& (Join-Path $PSScriptRoot 'auto_launch_cockpit.ps1') -Port $Port -OpenOperationsWall -StartupDelaySeconds 0
Write-Host 'Global API protection is enabled. The key is stored only in this Windows user environment.' -ForegroundColor Green

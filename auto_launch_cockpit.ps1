param(
    [string]$InstallPath = $PSScriptRoot,
    [int]$Port = 3109,
    [switch]$OpenOperationsWall,
    [int]$StartupDelaySeconds = 30
)

$ErrorActionPreference = 'Stop'
$reportPath = Join-Path $InstallPath 'data\startup-report.json'

function Test-DispatchPort {
    param([int]$LocalPort)

    return $null -ne (
        Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    )
}

function Test-DispatchHealth {
    param([int]$LocalPort)

    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/healthz" -TimeoutSec 3
        return $response.service -eq 'Grace Dispatch Console' -and $response.status -eq 'ok'
    } catch {
        return $false
    }
}

function Get-LocalAddresses {
    return @(
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -ne '127.0.0.1' -and
                $_.IPAddress -notlike '169.254.*' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            Select-Object -ExpandProperty IPAddress -Unique
    )
}

function Write-StartupReport {
    param(
        [int]$LocalPort,
        [string]$StartupStatus
    )

    $localAddresses = Get-LocalAddresses
    $operationsAccessConfigured = -not [string]::IsNullOrWhiteSpace($env:OPERATIONS_ACCESS_KEY)
    $operationsWallStatus = 'NOT_CONFIGURED'
    if ($operationsAccessConfigured) {
        try {
            $headers = @{ 'X-Operations-Access-Key' = $env:OPERATIONS_ACCESS_KEY }
            if (-not [string]::IsNullOrWhiteSpace($env:DISPATCH_API_KEY)) {
                $headers['X-API-Key'] = $env:DISPATCH_API_KEY
            }
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/api/operations/live" -Headers $headers -TimeoutSec 5
            $operationsWallStatus = if ($response.success) { 'HEALTHY' } else { 'UNHEALTHY' }
        } catch {
            $operationsWallStatus = "UNHEALTHY: $($_.Exception.Message)"
        }
    }

    $report = [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        computerName = $env:COMPUTERNAME
        startupStatus = $StartupStatus
        health = if (Test-DispatchHealth -LocalPort $LocalPort) { 'HEALTHY' } else { 'UNHEALTHY' }
        operationsWall = $operationsWallStatus
        addresses = [ordered]@{
            loopback = "http://127.0.0.1:$LocalPort"
            localNetwork = @($localAddresses | ForEach-Object { "http://$_`:$LocalPort" })
        }
        endpoints = [ordered]@{
            health = "http://127.0.0.1:$LocalPort/healthz"
            console = "http://127.0.0.1:$LocalPort/"
            operationsWall = "http://127.0.0.1:$LocalPort/operations.html"
        }
    }

    $report | ConvertTo-Json -Depth 5 | Set-Content -Path $reportPath -Encoding utf8
    Write-Host "Startup health report: $reportPath" -ForegroundColor Cyan
    Write-Host "Console health: $($report.health); Operations Wall: $operationsWallStatus" -ForegroundColor Cyan
    foreach ($address in $report.addresses.localNetwork) {
        Write-Host "Network console address: $address" -ForegroundColor Cyan
    }
}

if (-not (Test-Path (Join-Path $InstallPath 'app.js'))) {
    throw "Grace Dispatch Console was not found at $InstallPath."
}

$StartupDelaySeconds = [Math]::Max(0, $StartupDelaySeconds)
if ($StartupDelaySeconds -gt 0) {
    Write-Host "Waiting $StartupDelaySeconds seconds for Windows sign-in and network readiness..." -ForegroundColor Yellow
    Start-Sleep -Seconds $StartupDelaySeconds
}

$startupStatus = 'ALREADY_HEALTHY'
if (Test-DispatchPort -LocalPort $Port) {
    if (Test-DispatchHealth -LocalPort $Port) {
        Write-Host "Grace Dispatch Console is already healthy on port $Port; no restart is needed." -ForegroundColor Green
    } else {
        Write-Warning "Port $Port is already occupied by a service that did not pass the Grace health check. It was left untouched."
    }
} else {
    $node = Get-Command node.exe -ErrorAction Stop
    Write-Host "Starting Grace Dispatch Console on port $Port..." -ForegroundColor Yellow
    $previousPort = $env:PORT
    try {
        $env:PORT = $Port
        Start-Process -FilePath $node.Source `
            -ArgumentList 'app.js' `
            -WorkingDirectory $InstallPath `
            -WindowStyle Hidden
    } finally {
        if ($null -eq $previousPort) {
            Remove-Item Env:PORT -ErrorAction SilentlyContinue
        } else {
            $env:PORT = $previousPort
        }
    }

    $started = $false
    for ($attempt = 1; $attempt -le 15; $attempt++) {
        Start-Sleep -Seconds 1
        if (Test-DispatchHealth -LocalPort $Port) {
            $started = $true
            break
        }
    }

    if (-not $started) {
        throw "Grace Dispatch Console did not begin listening on port $Port within 15 seconds."
    }
    Write-Host "Grace Dispatch Console is online." -ForegroundColor Green
    $startupStatus = 'STARTED'
}

Write-StartupReport -LocalPort $Port -StartupStatus $startupStatus

if ($OpenOperationsWall) {
    if ([string]::IsNullOrWhiteSpace($env:OPERATIONS_ACCESS_KEY)) {
        Write-Warning 'OPERATIONS_ACCESS_KEY is not configured; the Operations Wall was not opened.'
    } else {
        $operationsKey = [uri]::EscapeDataString($env:OPERATIONS_ACCESS_KEY)
        $query = "operationsKey=$operationsKey"
        if (-not [string]::IsNullOrWhiteSpace($env:DISPATCH_API_KEY)) {
            $query += "&apiKey=$([uri]::EscapeDataString($env:DISPATCH_API_KEY))"
        }
        Start-Process "http://127.0.0.1:$Port/post_login.html?$query"
    }
}

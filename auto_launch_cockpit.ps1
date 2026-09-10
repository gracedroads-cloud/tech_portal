Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " INITIALIZING EH GRACED ROADS COCKPIT  " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 1. Gracefully stop only node processes running app.js
$nodeProcesses = Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*app.js*" }
foreach ($proc in $nodeProcesses) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2. Set directory and initiate application
Set-Location "C:\GracedRoadsSystem\backend-api"
Write-Host "[*] Launching Node.js Engine (Port 3000)..." -ForegroundColor Yellow
Start-Process -FilePath "node.exe" -ArgumentList "app.js" -WindowStyle Hidden

# 3. Port availability check loop
$maxRetries = 10
$retryCount = 0
$portOpen = $false

while (-not $portOpen -and $retryCount -lt $maxRetries) {
    Start-Sleep -Seconds 1
    $retryCount++
    $conn = Test-NetConnection -ComputerName "127.0.0.1" -Port 3000 -InformationLevel Quiet
    if ($conn) { $portOpen = $true }
}

if ($portOpen) {
    Write-Host "[?] Server is online. Opening Command Cockpit..." -ForegroundColor Green
    Start-Process "chrome.exe" -ArgumentList "http://localhost:3000/"
} else {
    Write-Host "[!] Server failed to respond on port 3000 within timeout." -ForegroundColor Red
}

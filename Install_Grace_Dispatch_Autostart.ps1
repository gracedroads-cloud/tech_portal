param(
    [string]$InstallPath = $PSScriptRoot,
    [int]$Port = 3109,
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $InstallPath 'auto_launch_cockpit.ps1'
if (-not (Test-Path $launcher)) {
    throw "Grace Dispatch launcher was not found at $launcher."
}

$taskName = 'Grace Dispatch Console - Logon'
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -InstallPath `"$InstallPath`" -Port $Port -OpenOperationsWall"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

try {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description 'Waits for Windows sign-in readiness, starts the Grace Dispatch Console if needed, opens the authorized Operations Wall, and records its health report.' `
        -Force `
        -ErrorAction Stop | Out-Null

    Write-Host "Installed or updated the '$taskName' scheduled task." -ForegroundColor Green
} catch {
    $startupDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    $shortcutPath = Join-Path $startupDirectory 'Grace Dispatch Console.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = 'powershell.exe'
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $InstallPath
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Starts the Grace Dispatch Console after Windows sign-in and records a health report.'
    $shortcut.Save()

    Write-Warning "Scheduled Task registration was denied. Installed the per-user Startup shortcut instead: $shortcutPath"
}

if ($RunNow) {
    & $launcher -InstallPath $InstallPath -Port $Port -OpenOperationsWall
}

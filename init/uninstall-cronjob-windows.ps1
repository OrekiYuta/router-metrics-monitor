# =============================================================
# uninstall-cronjob-windows.ps1
#   Removes the two scheduled tasks created by install-cronjob-windows.ps1
#
# Usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File init\uninstall-cronjob-windows.ps1
# =============================================================

$ErrorActionPreference = 'Stop'

$Tasks = @('RouterMetrics-Collect', 'RouterMetrics-Push')

foreach ($t in $Tasks) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
        Write-Host "Removed task: $t" -ForegroundColor Yellow
    } else {
        Write-Host "Task does not exist, skipping: $t"
    }
}

Write-Host "Uninstall complete." -ForegroundColor Green

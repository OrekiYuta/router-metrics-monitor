# =============================================================
# install-cronjob-windows.ps1
#   One-click registration of the collector / push scripts as Windows scheduled tasks
#
# Creates two tasks:
#   RouterMetrics-Collect  runs scripts/router-metrics-collect.js every 1 minute by default
#   RouterMetrics-Push     runs scripts/git-push.js once per day by default
#
# Usage (in the repo root, from an elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File init\install-cronjob-windows.ps1
#
# Customize frequency / push time:
#   powershell -ExecutionPolicy Bypass -File init\install-cronjob-windows.ps1 `
#       -CollectMinutes 1 -PushAt 03:30
#
# To uninstall, run: init\uninstall-cronjob-windows.ps1
# =============================================================

param(
    [int]$CollectMinutes = 1,     # collection frequency (minutes), default every minute
    [string]$PushAt = "04:00"     # daily push time (local time), default 04:00
)

$ErrorActionPreference = 'Stop'

$RepoDir   = Split-Path -Parent $PSScriptRoot
$CollectJs = Join-Path $RepoDir 'scripts\router-metrics-collect.js'
$PushJs    = Join-Path $RepoDir 'scripts\git-push.js'

$TaskCollect = 'RouterMetrics-Collect'
$TaskPush    = 'RouterMetrics-Push'

# ---- Pre-flight checks ----
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node not found; please install Node.js first (https://nodejs.org)." }
if (-not (Test-Path $CollectJs)) { throw "Cannot find $CollectJs" }
if (-not (Test-Path $PushJs))    { throw "Cannot find $PushJs" }
if (-not (Test-Path (Join-Path $RepoDir '.env'))) {
    Write-Host "Warning: no .env found; please copy .env.example to .env and fill in the config first." -ForegroundColor Yellow
}

Write-Host "Node:  $node"
Write-Host "Repo:  $RepoDir"
Write-Host ""

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

function Remove-IfExists($name) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "Already exists, recreating: $name"
    }
}

# ---- Collection task: every N minutes ----
Remove-IfExists $TaskCollect
$collectAction  = New-ScheduledTaskAction -Execute $node -Argument "`"$CollectJs`"" -WorkingDirectory $RepoDir
$collectTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $CollectMinutes)
Register-ScheduledTask -TaskName $TaskCollect -Action $collectAction -Trigger $collectTrigger `
    -Principal $principal -Settings $settings `
    -Description "Router metrics collection (every ${CollectMinutes} min, local commit)" | Out-Null
Write-Host "Created: $TaskCollect (every $CollectMinutes min)" -ForegroundColor Green

# ---- Push task: once per day ----
Remove-IfExists $TaskPush
$pushAction  = New-ScheduledTaskAction -Execute $node -Argument "`"$PushJs`"" -WorkingDirectory $RepoDir
$pushTrigger = New-ScheduledTaskTrigger -Daily -At $PushAt
Register-ScheduledTask -TaskName $TaskPush -Action $pushAction -Trigger $pushTrigger `
    -Principal $principal -Settings $settings `
    -Description "Router metrics push (daily at $PushAt, git push)" | Out-Null
Write-Host "Created: $TaskPush (daily at $PushAt)" -ForegroundColor Green

Write-Host ""
Write-Host "Done! Check it in Task Scheduler, or test immediately:" -ForegroundColor Green
Write-Host "  Start-ScheduledTask -TaskName $TaskCollect"
Write-Host "  Get-ScheduledTask -TaskName $TaskCollect | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Log files: $RepoDir\logs\collect.log and $RepoDir\logs\push.log"
Write-Host "Uninstall: powershell -ExecutionPolicy Bypass -File init\uninstall-cronjob-windows.ps1"

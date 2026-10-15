$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$guard = New-Object System.Threading.Mutex($false, 'Local\MyAICubeDailySchedulerLauncher')
if (-not $guard.WaitOne(0)) { $guard.Dispose(); exit 0 }
try {
    $workers = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -match 'scripts[/\\]daily-scheduler\.ts' -and
        $_.CommandLine -notmatch '--daily-only|--manual-news'
    })
    if ($workers.Count -gt 0) { Write-Output 'Scheduler is already running.'; exit 0 }
    $node = (Get-Command node.exe).Source
    $worker = Start-Process -FilePath $node -ArgumentList @('--env-file=.env', '--import', 'tsx', 'scripts/daily-scheduler.ts') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'data/local-scheduler.log') -RedirectStandardError (Join-Path $projectRoot 'data/local-scheduler-error.log') -PassThru
    Write-Output "Started scheduler: $($worker.Id)"
} finally {
    $guard.ReleaseMutex()
    $guard.Dispose()
}

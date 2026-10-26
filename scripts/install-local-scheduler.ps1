$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$data = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$launcher = Join-Path $PSScriptRoot 'ensure-local-scheduler.js'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Windowless scheduler launcher is missing.' }
if (-not (Test-Path -LiteralPath $wscript)) { throw 'Windows Script Host is required.' }
$existing = Get-ScheduledTask -TaskName 'MyAICube-LocalScheduler' -ErrorAction SilentlyContinue
if ($existing) {
    $backup = Join-Path $data ('local-scheduler-task-before-{0}.xml' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Export-ScheduledTask -TaskName $existing.TaskName | Set-Content -LiteralPath $backup -Encoding Unicode
}
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B //Nologo //E:JScript "{0}"' -f $launcher) -WorkingDirectory $projectRoot
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $account),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
if ($existing) {
    Set-ScheduledTask -TaskName $existing.TaskName -Action $action -Trigger $triggers -Settings $settings -ErrorAction Stop | Select-Object TaskName, State
} else {
    Register-ScheduledTask -TaskName 'MyAICube-LocalScheduler' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Keep the local scheduler running without console windows.' -ErrorAction Stop | Select-Object TaskName, State
}
Start-ScheduledTask -TaskName 'MyAICube-LocalScheduler'

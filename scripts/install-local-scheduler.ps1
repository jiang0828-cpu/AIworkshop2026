$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'ensure-local-scheduler.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcher) -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $account),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName 'MyAICube-LocalScheduler' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Keep the local scheduler running; news scheduling uses Asia/Shanghai 07:00 in the app database.' -Force | Select-Object TaskName, State
Start-ScheduledTask -TaskName 'MyAICube-LocalScheduler'

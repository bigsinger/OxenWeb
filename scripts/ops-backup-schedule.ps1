param(
  [Parameter(Mandatory=$true)][string]$LocalRoot,
  [Parameter(Mandatory=$true)][string]$EncryptedRoot,
  [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')][string]$At='02:00',
  [switch]$Install
)
$ErrorActionPreference='Stop'
$taskProjectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskNode=(Get-Command node -ErrorAction Stop).Source
$taskScript=Join-Path $PSScriptRoot 'ops-backup-coordinated.ts'
$taskLocal=[System.IO.Path]::GetFullPath($LocalRoot)
$taskEncrypted=[System.IO.Path]::GetFullPath($EncryptedRoot)
if($taskLocal -eq $taskEncrypted){throw 'Local and encrypted backup directories must be different. An independent disk/offline location must be supplied and verified.'}
function Quote-TaskLiteral([string]$Value){return "'"+$Value.Replace("'","''")+"'"}
$taskCommand='& '+(Quote-TaskLiteral $taskNode)+" '--import' 'tsx' "+(Quote-TaskLiteral $taskScript)+" '--execute' '--destination-root' "+(Quote-TaskLiteral $taskLocal)+" '--encrypted-root' "+(Quote-TaskLiteral $taskEncrypted)+"; exit `$LASTEXITCODE"
$taskEncoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskCommand))
$taskDigest=[Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($taskProjectRoot.ToLowerInvariant()))
$taskId=([BitConverter]::ToString($taskDigest)).Replace('-','').Substring(0,12).ToLowerInvariant()
$taskName='OxenWebDailyBackup-'+$taskId
if(-not $Install){[pscustomobject]@{TaskName=$taskName;At=$At;LocalRoot=$taskLocal;EncryptedRoot=$taskEncrypted;RunAs='Current interactive user; no stored password';StartWhenAvailable=$true;Installed=$false;OffsiteVerified=$false} | ConvertTo-Json; exit 0}
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'This checkout already has a scheduled backup task. Inspect it explicitly before replacing it.'}
$taskPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskAction=New-ScheduledTaskAction -Execute $taskPowerShell -Argument ("-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand "+$taskEncoded) -WorkingDirectory $taskProjectRoot
$taskTrigger=New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At,'HH:mm',[Globalization.CultureInfo]::InvariantCulture))
$taskPrincipal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([timespan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Oxen Web same-generation cold backup; secrets loaded from protected local environment, never task arguments.' | Out-Null
[pscustomobject]@{TaskName=$taskName;Installed=$true;At=$At;RequiresLoggedInUser=$true;NoPasswordStored=$true;OffsiteVerified=$false} | ConvertTo-Json

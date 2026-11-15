# Lists what starts with Windows: Run keys, Startup folders, sign-in and start-up scheduled tasks,
# and automatic services that are not part of Windows. Read-only. Prints JSON.
$ErrorActionPreference = 'SilentlyContinue'
function Get-Exe([string]$cmd) {
  if (-not $cmd) { return '' }
  $c = [Environment]::ExpandEnvironmentVariables($cmd).Trim()
  if ($c.StartsWith('"')) { $end = $c.IndexOf('"', 1); if ($end -gt 1) { return $c.Substring(1, $end - 1) } }
  $m = [regex]::Match($c, '^(.+?\.(exe|com|bat|cmd|vbs|js|ps1|lnk))', 'IgnoreCase')
  if ($m.Success) { return $m.Groups[1].Value }
  return ($c -split ' ')[0]
}
function Get-Info([string]$path) {
  $o = @{ publisher = ''; signer = ''; signed = $null; missing = $false }
  if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
    $o.publisher = [string](Get-Item -LiteralPath $path).VersionInfo.CompanyName
    $s = Get-AuthenticodeSignature -LiteralPath $path
    $o.signed = ($s.Status -eq 'Valid')
    if ($s.SignerCertificate) { $o.signer = $s.SignerCertificate.GetNameInfo('SimpleName', $false) }
  } elseif ($path) { $o.missing = $true }
  return $o
}
# Task Manager records on/off in StartupApproved: an odd first byte means turned off.
function Test-Approved([string]$key, [string]$name) {
  $v = (Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue).$name
  if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
  return $true
}
function New-Item2($kind, $name, $command, $file, $info, $scope, $enabled, $extra) {
  $o = [ordered]@{ kind = $kind; name = $name; command = $command; file = $file; publisher = $info.publisher; signer = $info.signer; signed = $info.signed; missing = $info.missing; scope = $scope; enabled = $enabled }
  foreach ($k in $extra.Keys) { $o[$k] = $extra[$k] }
  return [pscustomobject]$o
}
$out = New-Object System.Collections.ArrayList
$runs = @(
  @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run', 'user'),
  @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run', 'all'),
  @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32', 'all')
)
foreach ($r in $runs) {
  $k = Get-Item -LiteralPath $r[0]
  if (-not $k) { continue }
  foreach ($n in $k.GetValueNames()) {
    if (-not $n) { continue }
    $cmd = [string]$k.GetValue($n)
    $exe = Get-Exe $cmd
    [void]$out.Add((New-Item2 'run' $n $cmd $exe (Get-Info $exe) $r[2] (Test-Approved $r[1] $n) @{ approvedKey = $r[1]; valueName = $n }))
  }
}
$shell = New-Object -ComObject WScript.Shell
$folders = @(
  @([Environment]::GetFolderPath('Startup'), 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder', 'user'),
  @([Environment]::GetFolderPath('CommonStartup'), 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder', 'all')
)
foreach ($f in $folders) {
  if (-not $f[0]) { continue }
  foreach ($file in (Get-ChildItem -LiteralPath $f[0] -File | Where-Object { $_.Name -ne 'desktop.ini' })) {
    $target = $file.FullName
    if ($file.Extension -eq '.lnk') { $target = $shell.CreateShortcut($file.FullName).TargetPath }
    [void]$out.Add((New-Item2 'folder' $file.BaseName $file.FullName $target (Get-Info $target) $f[2] (Test-Approved $f[1] $file.Name) @{ approvedKey = $f[1]; valueName = $file.Name }))
  }
}
foreach ($t in (Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' })) {
  $atStart = $t.Triggers | Where-Object { $_.CimClass.CimClassName -in @('MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger') }
  if (-not $atStart) { continue }
  $a = $t.Actions | Select-Object -First 1
  $exe = [Environment]::ExpandEnvironmentVariables([string]$a.Execute).Trim('"')
  [void]$out.Add((New-Item2 'task' $t.TaskName ((([string]$a.Execute) + ' ' + ([string]$a.Arguments)).Trim()) $exe (Get-Info $exe) 'all' ($t.State -ne 'Disabled') @{ taskPath = $t.TaskPath; taskName = $t.TaskName }))
}
foreach ($s in (Get-CimInstance Win32_Service | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName })) {
  $exe = Get-Exe $s.PathName
  if ($exe -match '^(?i)[a-z]:\\Windows\\') { continue }
  $i = Get-Info $exe
  if ($i.signer -match 'Microsoft') { continue }
  [void]$out.Add((New-Item2 'service' $s.DisplayName $s.PathName $exe $i 'all' $true @{ service = $s.Name; delayed = [bool]$s.DelayedAutoStart }))
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress

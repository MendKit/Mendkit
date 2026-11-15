# What can be restored without a deep scan: the Recycle Bin, shadow copies (Previous Versions) and File History. Read-only.
$ErrorActionPreference = 'SilentlyContinue'
$bin = 0; $binBytes = [int64]0
try {
  $items = (New-Object -ComObject Shell.Application).NameSpace(10).Items()
  $bin = $items.Count
  foreach ($i in $items) { $binBytes += [int64]$i.Size }
} catch {}
$shadows = @()
foreach ($s in Get-CimInstance Win32_ShadowCopy) {
  $vol = Get-CimInstance Win32_Volume | Where-Object { $_.DeviceID -eq $s.VolumeName } | Select-Object -First 1
  $shadows += [pscustomobject]@{ drive = [string]$vol.DriveLetter; date = $s.InstallDate.ToString('o') }
}
$fh = $false
$cfg = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\FileHistory\Configuration'
if (Test-Path $cfg) { $fh = [bool](Get-ChildItem $cfg -Filter 'Config*.xml' | Select-Object -First 1) }
$od = [bool]$env:OneDrive
ConvertTo-Json -Depth 3 -Compress -InputObject ([pscustomobject]@{ bin = $bin; binBytes = $binBytes; shadows = @($shadows); fileHistory = $fh; oneDrive = $od })

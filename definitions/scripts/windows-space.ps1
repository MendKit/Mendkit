# Measures what can be cleared on Windows. Read-only. Prints JSON.
$ErrorActionPreference = 'SilentlyContinue'
function Get-Size([string[]]$paths, [string]$filter = '*') {
  $total = [int64]0
  foreach ($p in $paths) {
    if (-not $p -or -not (Test-Path -LiteralPath $p)) { continue }
    $item = Get-Item -LiteralPath $p -Force
    if ($item.PSIsContainer) {
      $sum = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -Filter $filter | Measure-Object -Property Length -Sum).Sum
      if ($sum) { $total += [int64]$sum }
    } else { $total += [int64]$item.Length }
  }
  return $total
}
$local = $env:LOCALAPPDATA
$win = $env:WINDIR
$browserCaches = @()
foreach ($b in @('Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Vivaldi')) {
  $root = Join-Path $local "$b\User Data"
  foreach ($prof in (Get-ChildItem -LiteralPath $root -Directory)) {
    foreach ($c in @('Cache', 'Code Cache', 'GPUCache', 'Service Worker\CacheStorage')) { $browserCaches += (Join-Path $prof.FullName $c) }
  }
}
foreach ($prof in (Get-ChildItem -LiteralPath (Join-Path $local 'Mozilla\Firefox\Profiles') -Directory)) { $browserCaches += (Join-Path $prof.FullName 'cache2') }
$recycle = [int64]0
(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $recycle += [int64]$_.Size }
$sizes = [ordered]@{
  'user-temp'  = Get-Size @($env:TEMP)
  'win-temp'   = Get-Size @("$win\Temp")
  'wu-cache'   = Get-Size @("$win\SoftwareDistribution\Download")
  'do-cache'   = Get-Size @("$win\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache")
  'recycle'    = $recycle
  'win-old'    = Get-Size @("$env:SystemDrive\Windows.old")
  'upgrade'    = Get-Size @("$env:SystemDrive\`$WINDOWS.~BT", "$env:SystemDrive\`$Windows.~WS", "$win\Panther")
  'dumps'      = Get-Size @("$win\MEMORY.DMP", "$win\Minidump", "$local\CrashDumps")
  'wer'        = Get-Size @("$env:ProgramData\Microsoft\Windows\WER\ReportArchive", "$env:ProgramData\Microsoft\Windows\WER\ReportQueue", "$local\Microsoft\Windows\WER")
  'thumbs'     = Get-Size @("$local\Microsoft\Windows\Explorer") 'thumbcache_*.db'
  'browser'    = Get-Size $browserCaches
  'hiber'      = Get-Size @("$env:SystemDrive\hiberfil.sys")
  'downloads'  = Get-Size @((New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path)
}
$ios = @()
foreach ($root in @("$env:APPDATA\Apple Computer\MobileSync\Backup", "$env:USERPROFILE\Apple\MobileSync\Backup")) {
  foreach ($d in (Get-ChildItem -LiteralPath $root -Directory)) {
    $name = ''; $date = ''
    $info = Join-Path $d.FullName 'Info.plist'
    if (Test-Path -LiteralPath $info) {
      $t = Get-Content -LiteralPath $info -Raw
      $m = [regex]::Match($t, '<key>Device Name</key>\s*<string>([^<]*)</string>'); if ($m.Success) { $name = $m.Groups[1].Value }
      $m = [regex]::Match($t, '<key>Last Backup Date</key>\s*<date>([^<]*)</date>'); if ($m.Success) { $date = $m.Groups[1].Value }
    }
    $ios += [pscustomobject]@{ path = $d.FullName; name = $name; date = $date; bytes = (Get-Size @($d.FullName)) }
  }
}
$large = Get-ChildItem -LiteralPath $env:USERPROFILE -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Length -gt 1GB -and $_.FullName -notlike "$local\*" -and $_.FullName -notlike "$env:APPDATA\*" } |
  Sort-Object Length -Descending | Select-Object -First 30 | ForEach-Object { [pscustomobject]@{ path = $_.FullName; bytes = $_.Length } }
$drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'"
[pscustomobject]@{
  sizes = $sizes; ios = @($ios); large = @($large); free = [int64]$drive.FreeSpace; total = [int64]$drive.Size
  downloadsPath = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
  hibernate = (Test-Path -LiteralPath "$env:SystemDrive\hiberfil.sys")
} | ConvertTo-Json -Depth 4 -Compress

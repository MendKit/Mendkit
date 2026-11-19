# Phones and cameras plugged in by USB, through the same Windows Shell that File Explorer uses.
# -List prints the devices and how many photos and videos each holds; -Copy copies new ones to -Dest.
param([switch]$List, [switch]$Copy, [string]$Device = '', [string]$Dest = '')
$ErrorActionPreference = 'SilentlyContinue'
$shell = New-Object -ComObject Shell.Application
$media = '\.(jpe?g|heic|heif|png|gif|webp|dng|mov|mp4|m4v|3gp|avi|mkv|webm)$'

function Get-PhotoFolders($device) {
  # Android: storage, then DCIM, Pictures and Movies. iPhone: Windows shows the camera folders
  # (100APPLE, 202411__ and so on) straight under Internal Storage, with no DCIM folder.
  $found = @()
  foreach ($store in $device.GetFolder.Items()) {
    if (-not $store.IsFolder) { continue }
    $inside = @($store.GetFolder.Items())
    $named = @($inside | Where-Object { $_.IsFolder -and $_.Name -match '^(DCIM|Pictures|Movies)$' })
    if ($named) { foreach ($f in $named) { $found += [pscustomobject]@{ store = $store.Name; folder = $f; label = "$($store.Name)\$($f.Name)" } } }
    elseif (@($inside | Where-Object { $_.IsFolder -and $_.Name -match '^(\d{3}[A-Z_]{5}|\d{6}_\w?)$' }).Count) {
      $found += [pscustomobject]@{ store = $store.Name; folder = $store; label = $store.Name }
    }
  }
  return $found
}
function Get-MediaItems($folder, $rel) {
  foreach ($i in $folder.GetFolder.Items()) {
    if ($i.IsFolder) { if ($i.Name -notmatch '^\.') { Get-MediaItems $i "$rel\$($i.Name)" } }
    elseif ($i.Name -match $media) { [pscustomobject]@{ item = $i; rel = $rel; name = $i.Name; size = [int64]$i.ExtendedProperty('System.Size'); date = $i.ExtendedProperty('System.DateModified') } }
  }
}
$devices = @($shell.NameSpace(17).Items() | Where-Object { -not $_.IsFileSystem -and $_.IsFolder -and $_.Path -match '^::|\\\\\?\\usb|wpd' })

if ($List) {
  $out = foreach ($d in $devices) {
    $folders = Get-PhotoFolders $d
    if (-not $folders) {
      # An untrusted or locked phone shows no storage, or empty storage. Storage with files but no camera folders just has no photos.
      $open = @(foreach ($st in $d.GetFolder.Items()) { if ($st.IsFolder -and @($st.GetFolder.Items()).Count) { $st } }).Count -gt 0
      [pscustomobject]@{ name = $d.Name; folders = @(); count = 0; bytes = 0; locked = -not $open }; continue
    }
    $items = @(foreach ($f in $folders) { Get-MediaItems $f.folder $f.label })
    [pscustomobject]@{ name = $d.Name; folders = @($folders | ForEach-Object { $_.label }); count = $items.Count; bytes = [int64]($items | Measure-Object -Property size -Sum).Sum; locked = $false }
  }
  ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
  exit 0
}

if ($Copy) {
  $d = $devices | Where-Object { $_.Name -eq $Device } | Select-Object -First 1
  if (-not $d) { 'PHONE_GONE'; exit 1 }
  $items = @(foreach ($f in Get-PhotoFolders $d) { Get-MediaItems $f.folder '' })
  "Found $($items.Count) photos and videos on $Device."
  $copied = 0; $skipped = 0; $failed = 0; $n = 0
  foreach ($m in $items) {
    $n++
    $when = if ($m.date) { [datetime]$m.date } else { Get-Date }
    $dir = Join-Path $Dest ('{0:yyyy}-{0:MM}' -f $when)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $target = Join-Path $dir $m.name
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -eq $m.size)) { $skipped++; continue }
    if (Test-Path -LiteralPath $target) {
      # Same name, different photo: copy into a side folder, then rename beside the first.
      $side = Join-Path $dir ".mendkit-$n"; New-Item -ItemType Directory -Force -Path $side | Out-Null
      $shell.NameSpace($side).CopyHere($m.item, 4 + 16 + 1024)
      $wait = 0; while (-not (Test-Path -LiteralPath (Join-Path $side $m.name)) -and $wait -lt 600) { Start-Sleep -Milliseconds 200; $wait++ }
      $k = 2; do { $alt = Join-Path $dir ("{0}-{1}{2}" -f [IO.Path]::GetFileNameWithoutExtension($m.name), $k, [IO.Path]::GetExtension($m.name)); $k++ } while (Test-Path -LiteralPath $alt)
      Start-Sleep -Milliseconds 300
      Move-Item -LiteralPath (Join-Path $side $m.name) -Destination $alt; Remove-Item -LiteralPath $side -Recurse -Force
      if (Test-Path -LiteralPath $alt) { $copied++ } else { $failed++ }
    } else {
      $shell.NameSpace($dir).CopyHere($m.item, 4 + 16 + 1024)
      # Copies from a phone finish in the background: wait for the whole file, about 2 minutes at most per file.
      $wait = 0; while ($wait -lt 600) { if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -ge $m.size)) { break }; Start-Sleep -Milliseconds 200; $wait++ }
      if (Test-Path -LiteralPath $target) { $copied++ } else { $failed++ }
    }
    if ($n % 25 -eq 0) { "Copied $copied, skipped $skipped of $($items.Count)..." }
  }
  "COPY_DONE copied=$copied skipped=$skipped failed=$failed"
  if ($failed) { exit 1 }
  exit 0
}

# Lists drive letters with their file system, size and the kind of disk they are on, for Recover deleted files. Read-only.
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
foreach ($v in Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -in @('Fixed', 'Removable') }) {
  $bus = ''; $media = ''
  $part = Get-Partition -DriveLetter $v.DriveLetter
  if ($part) {
    $disk = Get-Disk -Number $part.DiskNumber
    $bus = [string]$disk.BusType
    $pd = Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$part.DiskNumber } | Select-Object -First 1
    if ($pd) { $media = [string]$pd.MediaType }
  }
  $out += [pscustomobject]@{
    letter = [string]$v.DriveLetter; label = [string]$v.FileSystemLabel; fs = [string]$v.FileSystem
    size = [int64]$v.Size; free = [int64]$v.SizeRemaining; driveType = [string]$v.DriveType; bus = $bus; media = $media
  }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress

# Windows 11 upgrade readiness, read-only. Run as administrator for the TPM, Secure Boot and BitLocker answers.
$ErrorActionPreference = 'SilentlyContinue'
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')

$tpm = $null
$t = Get-CimInstance -Namespace root/cimv2/security/microsofttpm -ClassName Win32_Tpm
if ($t) { $tpm = [pscustomobject]@{ version = (($t.SpecVersion -split ',')[0]).Trim(); enabled = [bool]$t.IsEnabled_InitialValue; activated = [bool]$t.IsActivated_InitialValue } }
elseif ($admin) { $tpm = [pscustomobject]@{ version = 'none'; enabled = $false; activated = $false } }

$sb = $null
try { $sb = Confirm-SecureBootUEFI } catch { if ($_.Exception.Message -match 'not supported') { $sb = 'unsupported' } }
$fw = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control').PEFirmwareType   # 1 BIOS, 2 UEFI

$sysPart = Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':'))
$disk = if ($sysPart) { Get-Disk -Number $sysPart.DiskNumber } else { $null }
$vol = Get-Volume -DriveLetter ($env:SystemDrive.TrimEnd(':'))

$bl = $null
$blv = Get-BitLockerVolume -MountPoint $env:SystemDrive
if ($blv) { $bl = [string]$blv.ProtectionStatus }

$lic = Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | Select-Object -First 1

# Windows' own compatibility verdict, the one Windows Update uses: the newest target version it assessed.
$verdicts = @()
$root = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\TargetVersionUpgradeExperienceIndicators'
foreach ($k in Get-ChildItem $root) {
  $p = Get-ItemProperty $k.PSPath
  if ($k.PSChildName -match '^(UNV|Unified)$') { continue }
  $when = ''
  if ($p.Timestamp) { try { $when = [DateTime]::FromFileTimeUtc([BitConverter]::ToInt64([byte[]]$p.Timestamp, 0)).ToString('o') } catch { try { $when = [DateTime]::FromFileTimeUtc([int64]$p.Timestamp).ToString('o') } catch {} } }
  $verdicts += [pscustomobject]@{ target = $k.PSChildName; upgEx = [string]$p.UpgEx; red = [string]$p.RedReason; gated = [string]$p.GatedBlockId; date = $when }
}
$moSetup = (Get-ItemProperty 'HKLM:\SYSTEM\Setup\MoSetup').AllowUpgradesWithUnsupportedTPMOrCPU

ConvertTo-Json -Depth 4 -Compress -InputObject ([pscustomobject]@{
  admin = $admin
  product = [string]$cv.ProductName; edition = [string]$cv.EditionID; version = [string]$cv.DisplayVersion
  build = [int]$cv.CurrentBuildNumber; ubr = [int]$cv.UBR; arch = [string]$env:PROCESSOR_ARCHITECTURE
  cpu = [string]$cpu.Name; cpuMaker = [string]$cpu.Manufacturer; cores = [int]$cpu.NumberOfCores; mhz = [int]$cpu.MaxClockSpeed
  ramGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  tpm = $tpm; secureBoot = $sb; firmware = $fw
  partitionStyle = [string]$disk.PartitionStyle; diskGb = [math]::Round($disk.Size / 1GB); freeGb = [math]::Round($vol.SizeRemaining / 1GB, 1)
  bitlocker = $bl; activated = ($lic.LicenseStatus -eq 1)
  verdicts = @($verdicts); bypass = $moSetup
})

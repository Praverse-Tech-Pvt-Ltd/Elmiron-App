<#
.SYNOPSIS
  FE-D12 3 -- give the Android EMULATOR a position, so check-in and check-out get a fix in a demo.

.DESCRIPTION
  The method recorded in PROJECT-OVERVIEW.md, FE-D10, "Mock location, for the next reader":
  `adb emu geo fix` answers OK and delivers nothing to the app, and a `fused` test provider alone
  did not reach it either. What works:
    1. allow the shell's mock-location app-op:  appops set 2000 android:mock_location allow
    2. add and enable test providers for fused, gps and network;
    3. push the position to all three, over and over, while the app is asking.
  So this script keeps pushing until you stop it with Ctrl+C.

  It refuses to run unless EXACTLY ONE device is attached to adb and its serial starts with
  "emulator-". Every adb call names that serial. It never touches a real phone: a real phone
  gets its position from the device, and faking one would fabricate the fact check-in records.

  It removes nothing. The test providers and the app-op stay until the emulator restarts.

  What the presenter says: "This is the emulator; on a real phone the location comes from the
  device."

.PARAMETER Lat
  Latitude. Defaults to the seeded clinic, 18.5204 (services/api/scripts/seed-day.mjs).

.PARAMETER Lon
  Longitude. Defaults to the seeded clinic, 73.8567.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\field\scripts\demo-emulator-location.ps1
#>
[CmdletBinding()]
param(
  [double]$Lat = 18.5204,
  [double]$Lon = 73.8567
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    ok: $Text" -ForegroundColor Green }
function Write-Refusal([string]$Text) { Write-Host "    REFUSED: $Text" -ForegroundColor Red }

function Stop-Refused([string]$Text) {
  Write-Refusal $Text
  Write-Host 'NOT STARTED. Nothing on any device was changed.' -ForegroundColor Red
  exit 1
}

Write-Host "demo-emulator-location: -Lat $Lat -Lon $Lon"

if ($Lat -lt -90 -or $Lat -gt 90 -or $Lon -lt -180 -or $Lon -gt 180) {
  Stop-Refused "-Lat must be -90..90 and -Lon -180..180. Latitude comes first."
}

if ($null -eq (Get-Command adb -ErrorAction SilentlyContinue)) {
  Stop-Refused 'adb is not on PATH.'
}

Write-Step 'Checking adb: exactly one device, and it is an emulator'
# Every attached device counts, whatever its state: a real phone that is "unauthorized" or
# "offline" is still a real phone on this cable, and "exactly one emulator" must mean exactly that.
$devices = @(
  & adb devices |
    Select-Object -Skip 1 |
    Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\*' } |
    ForEach-Object { ($_ -split '\s+')[0] }
)
if ($devices.Count -ne 1) {
  Stop-Refused "adb sees $($devices.Count) device(s): $($devices -join ', '). Exactly one, the emulator, must be attached."
}
$serial = $devices[0]
if (-not $serial.StartsWith('emulator-')) {
  Stop-Refused "the one device is '$serial', which is not an emulator. This script never touches a real phone."
}
$state = (& adb -s $serial get-state 2>&1 | Out-String).Trim()
if ($state -ne 'device') {
  Stop-Refused "$serial is '$state', not ready. Wait for it to finish booting."
}
Write-Ok "$serial"

$invariant = [Globalization.CultureInfo]::InvariantCulture
$location = [string]::Format($invariant, '{0},{1}', $Lat, $Lon)
$providers = @('fused', 'gps', 'network')

Write-Step 'Allowing mock location for the shell, and adding test providers'
& adb -s $serial shell appops set 2000 android:mock_location allow
foreach ($provider in $providers) {
  # Already added (a second run, or FE-D10's) answers with an error and changes nothing.
  & adb -s $serial shell cmd location providers add-test-provider $provider 2>&1 | Out-Null
  & adb -s $serial shell cmd location providers set-test-provider-enabled $provider true
}
Write-Ok "test providers enabled: $($providers -join ', ')"

Write-Host ''
Write-Host "Pushing $location to $serial every second. Press Ctrl+C to stop." -ForegroundColor Green
Write-Host 'Presenter: "This is the emulator; on a real phone the location comes from the device."'

$pushes = 0
try {
  while ($true) {
    foreach ($provider in $providers) {
      & adb -s $serial shell cmd location providers set-test-provider-location $provider --location $location --accuracy 12
    }
    $pushes += 1
    if ($pushes % 30 -eq 0) { Write-Host "    still pushing ($pushes)... Ctrl+C to stop" }
    Start-Sleep -Seconds 1
  }
}
finally {
  Write-Host ''
  Write-Host "Stopped after $pushes push(es). The test providers stay until the emulator restarts; nothing was removed."
}

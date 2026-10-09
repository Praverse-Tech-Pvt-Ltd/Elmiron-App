<#
.SYNOPSIS
  BE-W177 -- build the PRODUCTION (sideloaded) APK, signed with the company's release key, or refuse.

.DESCRIPTION
  The same prebuild + Gradle flow as build-demo-apk.ps1, without the demo parts. Refuses, naming
  the problem and never printing a value, if:
    - the working tree is not clean, or an ignored apps/field/.env* file exists (Expo would bake it in);
    - scripts/release-build-checks.mjs refuses the environment: the app configuration
      (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY, EXPO_PUBLIC_APP_*), the version code
      (FIELD_ANDROID_VERSION_CODE), the four release-signing values (FIELDFORCE_UPLOAD_STORE_FILE,
      _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD), the public debug key, demo/recording/coaching;
    - -ExpectSha256 (the release certificate's SHA-256 fingerprint, which is public) is missing;
    - no usable CMake is installed (as build-demo-apk.ps1).

  Then: clean prebuild with no DEMO_CLEARTEXT_HOSTS (so plugins/release-signing.cjs wires the release
  key and Gradle's own guard refuses a missing one); CMake as the demo script; Gradle
  `:app:createBundleReleaseJsAndAssets --rerun assembleRelease`; check the APK's name, version code
  and baked Supabase address; `verify-release-apk.mjs --expect-sha256`; copy to C:\dev\release-apk\
  without overwriting.

  The signing values are read from this process's environment and handed to Gradle as
  ORG_GRADLE_PROJECT_* variables -- never on a command line, never in a file. Every environment
  variable this script sets is restored when it ends. The signing architecture is BE-W169's; this
  script does not change it.

.PARAMETER ExpectSha256
  The SHA-256 fingerprint of the release certificate (64 hex digits; colons allowed).

.PARAMETER CheckOnly
  Run every refusal check and stop. Builds nothing.

.PARAMETER CmakeDir
  A CMake install directory to use instead of searching (3.31 or newer).

.EXAMPLE
  # In the operator's own shell; the values are set there, never written into the repository.
  $env:FIELD_ANDROID_VERSION_CODE = '2'
  pwsh apps\field\scripts\build-release-apk.ps1 -ExpectSha256 'AB:CD:...'
#>
param(
  [string]$ExpectSha256 = '',
  [switch]$CheckOnly,
  [string]$CmakeDir = ''
)

$ErrorActionPreference = 'Stop'
$AppDir = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AppDir)
$AndroidDir = Join-Path $AppDir 'android'
$ReleaseApkDir = 'C:\dev\release-apk'
$CmakeMinimum = [version]'3.31'
$Cmake = $null
$Signing = @(
  'FIELDFORCE_UPLOAD_STORE_FILE', 'FIELDFORCE_UPLOAD_STORE_PASSWORD',
  'FIELDFORCE_UPLOAD_KEY_ALIAS', 'FIELDFORCE_UPLOAD_KEY_PASSWORD'
)

$Touched = @('DEMO_CLEARTEXT_HOSTS', 'ANDROID_HOME', 'JAVA_TOOL_OPTIONS', 'Path') +
  @($Signing | ForEach-Object { "ORG_GRADLE_PROJECT_$_" })
$Saved = @{}
foreach ($name in $Touched) { $Saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    ok: $Text" -ForegroundColor Green }
function Write-Refusal([string]$Text) { Write-Host "    REFUSED: $Text" -ForegroundColor Red }

# As build-demo-apk.ps1: through cmd, so stderr cannot become a PowerShell error record.
function Invoke-Native([string]$WorkingDir, [string]$CommandLine, [string]$LogFile) {
  & cmd.exe /d /c "cd /d `"$WorkingDir`" && $CommandLine > `"$LogFile`" 2>&1"
  return $LASTEXITCODE
}

function Get-GitDirt {
  $out = & cmd.exe /d /c "git -C `"$RepoRoot`" status --porcelain --untracked-files=all 2>&1"
  if ($LASTEXITCODE -ne 0) { return @("git status failed: $out") }
  return @($out | Where-Object { $_ -ne '' })
}

# CMake: the same resolution as build-demo-apk.ps1 (W2-F A3), whose comments explain the 3.31 floor.
function Get-CmakeCandidate([string]$Dir) {
  $exe = Join-Path $Dir 'bin\cmake.exe'
  if (-not (Test-Path $exe)) { return $null }
  $line = (& cmd.exe /d /c "`"$exe`" --version 2>nul" | Select-Object -First 1)
  if ($line -notmatch 'cmake version (\d+\.\d+(\.\d+)?)') { return $null }
  $version = [version]$Matches[1]
  $ninjaDir = @((Join-Path $Dir 'bin'), (Join-Path (Split-Path -Parent $Dir) 'Ninja')) |
    Where-Object { Test-Path (Join-Path $_ 'ninja.exe') } | Select-Object -First 1
  if ($null -eq $ninjaDir) { return $null }
  return [pscustomobject]@{ Dir = $Dir; Version = $version; NinjaDir = $ninjaDir }
}

function Resolve-Cmake {
  if ($CmakeDir -ne '') {
    return Get-CmakeCandidate $CmakeDir | Where-Object { $null -ne $_ -and $_.Version -ge $CmakeMinimum }
  }
  $sdk = if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) { Join-Path $env:LOCALAPPDATA 'Android\Sdk' } else { $env:ANDROID_HOME }
  $fromSdk = Get-ChildItem -Path (Join-Path $sdk 'cmake') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-CmakeCandidate $_.FullName } |
    Where-Object { $null -ne $_ -and $_.Version -ge $CmakeMinimum } |
    Sort-Object Version -Descending | Select-Object -First 1
  if ($null -ne $fromSdk) { return $fromSdk }
  $vsRoots = @("$env:ProgramFiles\Microsoft Visual Studio", "${env:ProgramFiles(x86)}\Microsoft Visual Studio")
  return Get-ChildItem -Path $vsRoots -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue } |
    ForEach-Object { Get-CmakeCandidate (Join-Path $_.FullName 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake') } |
    Where-Object { $null -ne $_ -and $_.Version -ge $CmakeMinimum } |
    Sort-Object Version -Descending | Select-Object -First 1
}

function Set-CmakeDir {
  $props = Join-Path $AndroidDir 'local.properties'
  $lines = @(if (Test-Path $props) { Get-Content $props | Where-Object { $_ -notmatch '^\s*cmake\.dir\s*=' } })
  if (-not ($lines | Where-Object { $_ -match '^\s*sdk\.dir\s*=' })) {
    $lines += 'sdk.dir=' + ($env:ANDROID_HOME -replace '\\', '/')
  }
  $lines += 'cmake.dir=' + ($Cmake.Dir -replace '\\', '/')
  [IO.File]::WriteAllLines($props, [string[]]$lines, (New-Object System.Text.UTF8Encoding $false))
  $written = @(Get-Content $props | Where-Object { $_ -match '^\s*cmake\.dir\s*=' })
  if ($written.Count -ne 1) { throw "cmake.dir is not set exactly once in $props after writing it" }
  $env:Path = "$($Cmake.NinjaDir);$env:Path"
}

function Invoke-Checks {
  $failures = 0

  Write-Step 'Checking the working tree'
  $dirt = Get-GitDirt
  if ($dirt.Count -gt 0) {
    Write-Refusal 'the working tree is not clean, so this APK would not trace to a commit:'
    $dirt | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" }
    $failures++
  } else {
    Write-Ok 'clean'
  }
  $envFiles = @(Get-ChildItem -Path $AppDir -Filter '.env*' -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne '.env.example' })
  if ($envFiles.Count -gt 0) {
    Write-Refusal ('Expo reads these ignored files into the bundle, and no commit records them: ' +
      (($envFiles | ForEach-Object { $_.Name }) -join ', ') + '. Move them out of apps\field.')
    $failures++
  }

  Write-Step 'Checking the release configuration (scripts/release-build-checks.mjs; no value printed)'
  & node (Join-Path $PSScriptRoot 'release-build-checks.mjs')
  if ($LASTEXITCODE -ne 0) { $failures++ }

  Write-Step 'Checking -ExpectSha256'
  $normalised = ($ExpectSha256 -replace '[\s:]', '').ToLowerInvariant()
  if ($normalised -notmatch '^[0-9a-f]{64}$') {
    Write-Refusal ('-ExpectSha256 must be the release certificate''s SHA-256 fingerprint (64 hex ' +
      'digits). Without it the finished APK cannot be checked against the release key.')
    $failures++
  } else {
    Write-Ok 'a SHA-256 fingerprint'
  }

  Write-Step "Finding a CMake ($CmakeMinimum or newer) with its own ninja"
  $script:Cmake = Resolve-Cmake
  if ($null -eq $script:Cmake) {
    Write-Refusal 'no usable CMake (see build-demo-apk.ps1, Resolve-Cmake). Install one, or pass -CmakeDir.'
    $failures++
  } else {
    Write-Ok "CMake $($script:Cmake.Version) at $($script:Cmake.Dir)"
  }
  return $failures
}

function Find-Aapt2 {
  $root = Join-Path $env:ANDROID_HOME 'build-tools'
  $tool = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Name -replace '[^0-9.].*$', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($null -eq $tool) { throw "aapt2.exe not found under $root" }
  return $tool
}

function Test-Apk([string]$Apk) {
  $aapt2 = Find-Aapt2
  $badging = & cmd.exe /d /c "`"$aapt2`" dump badging `"$Apk`" 2>nul"
  $label = ($badging | Where-Object { $_ -match "^application-label:'" }) -replace "^application-label:'(.*)'$", '$1'
  if ($label -match '\(demo\)$') { throw "display name is '$label': this is a demo build" }
  Write-Ok "display name: $label"
  $package = ($badging | Where-Object { $_ -match '^package:' } | Select-Object -First 1)
  if ($package -notmatch "versionCode='(\d+)'" -or $Matches[1] -ne $env:FIELD_ANDROID_VERSION_CODE.Trim()) {
    throw "the APK's versionCode is not FIELD_ANDROID_VERSION_CODE ($package)"
  }
  Write-Ok "versionCode $($Matches[1])"

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Apk)
  try {
    $entry = $zip.GetEntry('assets/index.android.bundle')
    if ($null -eq $entry) { throw 'the APK has no JS bundle' }
    $reader = New-Object IO.StreamReader($entry.Open())
    try { $bundle = $reader.ReadToEnd() } finally { $reader.Dispose() }
  } finally {
    $zip.Dispose()
  }
  if (-not $bundle.Contains($env:EXPO_PUBLIC_SUPABASE_URL.Trim())) {
    throw 'the JS bundle does not contain EXPO_PUBLIC_SUPABASE_URL'
  }
  Write-Ok "the JS bundle contains $($env:EXPO_PUBLIC_SUPABASE_URL.Trim())"
}

function Invoke-Build {
  $commit = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
  $logDir = Join-Path $env:TEMP 'build-release-apk'
  $null = New-Item -ItemType Directory -Force -Path $logDir

  if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  if (-not (Test-Path $env:ANDROID_HOME)) { throw "ANDROID_HOME ($env:ANDROID_HOME) does not exist" }
  $javaVersion = (& cmd.exe /d /c 'java -version 2>&1' | Select-Object -First 1)
  if ($javaVersion -match 'version "(\d+)') {
    if ([int]$Matches[1] -ge 22) { $env:JAVA_TOOL_OPTIONS = '--enable-native-access=ALL-UNNAMED' }
  }

  Write-Step 'Clean prebuild, release signing (regenerates the gitignored android folder)'
  $env:DEMO_CLEARTEXT_HOSTS = $null
  $log = Join-Path $logDir 'prebuild.log'
  if ((Invoke-Native $AppDir 'npx expo prebuild --platform android --no-install --clean' $log) -ne 0) {
    Get-Content $log -Tail 30 | ForEach-Object { Write-Host "      $_" }
    throw "prebuild failed; full log: $log"
  }
  if ((Get-GitDirt).Count -gt 0) { throw 'prebuild changed tracked files; the build would not match the commit' }
  if (-not (Select-String -Path (Join-Path $AndroidDir 'app\build.gradle') -SimpleMatch 'signingConfig signingConfigs.release' -Quiet)) {
    throw 'the generated build.gradle does not sign the release build with the release key'
  }
  Write-Ok 'prebuild done; release build type signed with signingConfigs.release'

  Set-CmakeDir

  # Gradle reads ORG_GRADLE_PROJECT_<name> as project property <name>: the values stay in memory.
  foreach ($name in $Signing) {
    [Environment]::SetEnvironmentVariable("ORG_GRADLE_PROJECT_$name", [Environment]::GetEnvironmentVariable($name, 'Process'), 'Process')
  }

  Write-Step 'Building: :app:createBundleReleaseJsAndAssets --rerun assembleRelease (about 5-10 min)'
  $log = Join-Path $logDir 'gradle.log'
  $gradle = '.\gradlew.bat :app:createBundleReleaseJsAndAssets --rerun assembleRelease --no-daemon --max-workers=3'
  if ((Invoke-Native $AndroidDir $gradle $log) -ne 0) {
    Get-Content $log -Tail 40 | ForEach-Object { Write-Host "      $_" }
    throw "the Gradle build failed; full log: $log"
  }
  Write-Ok 'BUILD SUCCESSFUL'

  $apk = Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path $apk)) { throw "no APK at $apk" }

  Write-Step 'Checking the APK'
  Test-Apk $apk

  Write-Step 'Checking who signed it (verify-release-apk.mjs)'
  & node (Join-Path $PSScriptRoot 'verify-release-apk.mjs') $apk --expect-sha256 $ExpectSha256
  if ($LASTEXITCODE -ne 0) { throw 'verify-release-apk.mjs refused the APK; do not install it' }

  if ((& git -C $RepoRoot rev-parse --short HEAD).Trim() -ne $commit) { throw 'HEAD moved during the build' }

  $null = New-Item -ItemType Directory -Force -Path $ReleaseApkDir
  $target = Join-Path $ReleaseApkDir "field-force-v$($env:FIELD_ANDROID_VERSION_CODE.Trim())-$commit.apk"
  if (Test-Path $target) { throw "$target already exists; not overwriting it." }
  [IO.File]::Copy($apk, $target, $false)
  $sha = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLowerInvariant()

  Write-Host ''
  Write-Host 'RELEASE APK READY' -ForegroundColor Green
  Write-Host "  path:        $target"
  Write-Host "  commit:      $commit"
  Write-Host "  versionCode: $($env:FIELD_ANDROID_VERSION_CODE.Trim())"
  Write-Host "  file sha256: $sha"
}

$code = 0
try {
  Write-Host "build-release-apk$(if ($CheckOnly) { ' -CheckOnly' })"
  $failures = Invoke-Checks
  if ($failures -gt 0) {
    Write-Host ''
    Write-Host "NOT BUILT: $failures check(s) refused. Nothing was changed." -ForegroundColor Red
    $code = 1
  } elseif ($CheckOnly) {
    Write-Host ''
    Write-Host 'All checks passed. -CheckOnly: nothing built.' -ForegroundColor Green
  } else {
    Invoke-Build
  }
} catch {
  Write-Host ''
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  $code = 1
} finally {
  foreach ($name in $Touched) { [Environment]::SetEnvironmentVariable($name, $Saved[$name], 'Process') }
}
exit $code

<#
.SYNOPSIS
  FE-D8 2 -- build the demo APK, refusing every condition that has produced a broken or untraceable
  demo build before.

.DESCRIPTION
  Refuses to build, with a message naming the problem, if:
    - the working tree is not clean (every demo APK has to trace to a commit);
    - an ignored apps/field/.env* file exists (Expo would read it, and it is not in any commit);
    - -Ip is not assigned to an active network adapter on this machine;
    - local Supabase does not answer at http://<Ip>:54321/auth/v1/health;
    - `supabase status` gives no publishable key;
    - a required EXPO_PUBLIC_* value is missing, empty or malformed;
    - EXPO_PUBLIC_COACHING_ENABLED or EXPO_PUBLIC_RECORDING_ENABLED is set (both stay off in a demo).
  Does not check the mock at :4010: nothing in the app calls it (W2-B B3). EXPO_PUBLIC_API_BASE_URL
  is still set, only because app/_layout.tsx refuses to start a release build without it.

  Then: clean prebuild with DEMO_CLEARTEXT_HOSTS=<Ip>; re-apply and verify the CMake 3.31.6 pin;
  build with the JS bundle forced to rebuild; verify the APK (display name, cleartext hosts, baked
  Supabase address); copy it to C:\dev\demo-apk\ without overwriting; print path, size and commit.

  The Supabase key is read into this process's environment only. It is never printed and never
  written to a file, and every environment variable this script sets is restored when it ends.

.PARAMETER Ip
  The laptop's LAN address, as the phone will reach it. Required; there is no default.

.PARAMETER CheckOnly
  Run every refusal check and stop. Builds nothing.

.PARAMETER CoachingCheck
  FE-D16. A local check build with Coaching ON, which is never a demo build. With this switch,
  EXPO_PUBLIC_COACHING_ENABLED must be exactly 'true' (anything else is refused), and the APK is
  named field-force-demo-<ip>-<date>-<commit>-coaching-check.apk, so it can never be mistaken for
  the demo APK. Without it, a set EXPO_PUBLIC_COACHING_ENABLED is refused exactly as before.
  EXPO_PUBLIC_RECORDING_ENABLED is refused either way.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\field\scripts\build-demo-apk.ps1 -Ip 192.168.1.15
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Ip,

  [switch]$CheckOnly,

  [switch]$CoachingCheck
)

$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $PSScriptRoot          # apps\field
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AppDir)
$AndroidDir = Join-Path $AppDir 'android'
$DemoApkDir = 'C:\dev\demo-apk'
$CmakeVersion = '3.31.6'
$CmakePin = "externalNativeBuild { cmake { version '$CmakeVersion' } }"

<#
  THE REQUIRED EXPO_PUBLIC_* VALUES, AND WHERE THIS LIST COMES FROM.

  apps/field/src/config.ts passes these to loadAppConfig (packages/core/src/shared/config.ts), whose
  AppConfigSchema requires:
    supabaseUrl      <- EXPO_PUBLIC_SUPABASE_URL             z.url()         (set here, from -Ip)
    supabasePublishableKey <- EXPO_PUBLIC_SUPABASE_KEY       z.string().min(1) (set here, from `supabase status`)
    jwtAudience      <- EXPO_PUBLIC_APP_JWT_AUDIENCE         z.string().min(1)
    siteUrl          <- EXPO_PUBLIC_APP_SITE_URL             z.url()
    deepLinkScheme   <- EXPO_PUBLIC_APP_DEEP_LINK_SCHEME     min(1), /^[a-z][a-z0-9+.-]*$/
  and accepts as optional:
    additionalRedirectUrls <- EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS  (empty is valid; each entry z.url())
  apps/field/src/api-target.ts additionally makes a release build with no real
  EXPO_PUBLIC_API_BASE_URL show the "not set up" screen (set here, from -Ip).

  A value missing from that schema is not a warning in a release build: the app throws
  "Invalid application configuration" on launch and closes (FE-D7 5). So it is refused here.
  If AppConfigSchema gains a field, add it to this list.
#>
$OperatorValues = @(
  @{ Name = 'EXPO_PUBLIC_APP_JWT_AUDIENCE'; Kind = 'text' },
  @{ Name = 'EXPO_PUBLIC_APP_SITE_URL'; Kind = 'url' },
  @{ Name = 'EXPO_PUBLIC_APP_DEEP_LINK_SCHEME'; Kind = 'scheme' }
)
$OptionalUrlList = 'EXPO_PUBLIC_APP_ADDITIONAL_REDIRECT_URLS'
$MustBeUnset = @('EXPO_PUBLIC_COACHING_ENABLED', 'EXPO_PUBLIC_RECORDING_ENABLED')

# Everything this script sets in the environment, so it can be put back exactly.
$Touched = @(
  'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY',
  'DEMO_CLEARTEXT_HOSTS', 'ANDROID_HOME', 'JAVA_TOOL_OPTIONS'
)
$Saved = @{}
foreach ($name in $Touched) { $Saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    ok: $Text" -ForegroundColor Green }
function Write-Refusal([string]$Text) { Write-Host "    REFUSED: $Text" -ForegroundColor Red }

function Test-AbsoluteUrl([string]$Value) {
  $uri = $null
  return [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -and ($uri.Scheme -in @('http', 'https'))
}

function Test-Healthy([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri $Url
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
  } catch {
    return $false
  }
}

# Native commands run through cmd so their stderr cannot become a PowerShell error record. The
# directory is set inside cmd itself, and anything run from it is named with .\ -- with
# NoDefaultCurrentDirectoryInExePath set, cmd will not run a bare `gradlew.bat` from the current
# directory (found on the first real run).
function Invoke-Native([string]$WorkingDir, [string]$CommandLine, [string]$LogFile) {
  & cmd.exe /d /c "cd /d `"$WorkingDir`" && $CommandLine > `"$LogFile`" 2>&1"
  return $LASTEXITCODE
}

function Get-GitDirt {
  $out = & cmd.exe /d /c "git -C `"$RepoRoot`" status --porcelain --untracked-files=all 2>&1"
  if ($LASTEXITCODE -ne 0) { return @("git status failed: $out") }
  return @($out | Where-Object { $_ -ne '' })
}

# ---------------------------------------------------------------------------------------------
# The refusal checks. All of them run, so one attempt reports every problem at once.
# ---------------------------------------------------------------------------------------------
function Invoke-Checks {
  $failures = 0

  Write-Step "Checking -Ip $Ip"
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Ip, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') {
    Write-Refusal "-Ip '$Ip' is not an IPv4 address."
    return 1 + $failures
  }
  $assigned = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $Ip })
  $active = @($assigned | Where-Object {
      $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
      $null -ne $adapter -and $adapter.Status -eq 'Up'
    })
  if ($active.Count -eq 0) {
    Write-Refusal ("$Ip is not assigned to an active network adapter on this machine. The APK bakes " +
      "this address in, so a wrong one is a demo that cannot reach its server. Run ipconfig and " +
      "use the Wi-Fi adapter's IPv4 address.")
    $failures++
  } else {
    Write-Ok "$Ip is on '$($active[0].InterfaceAlias)', which is up"
  }

  Write-Step 'Checking the working tree'
  $dirt = Get-GitDirt
  if ($dirt.Count -gt 0) {
    Write-Refusal ("the working tree is not clean, so this APK would not trace to a commit. " +
      "Commit, or move out of the repo, these:")
    $dirt | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" }
    $failures++
  } else {
    Write-Ok 'clean'
  }
  $envFiles = @(Get-ChildItem -Path $AppDir -Filter '.env*' -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne '.env.example' })
  if ($envFiles.Count -gt 0) {
    Write-Refusal ("Expo reads these ignored files into the bundle, and no commit records them: " +
      (($envFiles | ForEach-Object { $_.Name }) -join ', ') + ". Move them out of apps\field.")
    $failures++
  }

  Write-Step "Checking local Supabase at http://${Ip}:54321"
  if (Test-Healthy "http://${Ip}:54321/auth/v1/health") {
    Write-Ok 'auth health answers'
  } else {
    Write-Refusal ("local Supabase does not answer at http://${Ip}:54321/auth/v1/health. Start it " +
      "(pnpm db:start) and check the address; the app signs in against it.")
    $failures++
  }

  Write-Step 'Reading the Supabase publishable key from `supabase status` (never printed)'
  $status = & cmd.exe /d /c "cd /d `"$RepoRoot`" && pnpm exec supabase --workdir services/api status -o env 2>nul"
  $keyLine = @($status | Where-Object { $_ -match '^PUBLISHABLE_KEY=' }) | Select-Object -First 1
  $key = if ($null -eq $keyLine) { '' } else { ($keyLine -replace '^PUBLISHABLE_KEY=', '').Trim('"') }
  if ($key -eq '') {
    Write-Refusal '`supabase status` gave no PUBLISHABLE_KEY. Is the local stack running?'
    $failures++
  } else {
    $env:EXPO_PUBLIC_SUPABASE_KEY = $key
    Write-Ok "key read into this process's environment ($($key.Length) characters)"
  }
  $key = $null

  Write-Step 'Checking the required EXPO_PUBLIC_* values (list: packages/core/src/shared/config.ts)'
  $env:EXPO_PUBLIC_SUPABASE_URL = "http://${Ip}:54321"
  # Still required: app/_layout.tsx shows "not set up" without it, though nothing calls it (W2-B B3).
  $env:EXPO_PUBLIC_API_BASE_URL = "http://${Ip}:4010"
  Write-Ok "EXPO_PUBLIC_SUPABASE_URL = $env:EXPO_PUBLIC_SUPABASE_URL (from -Ip)"
  Write-Ok "EXPO_PUBLIC_API_BASE_URL = $env:EXPO_PUBLIC_API_BASE_URL (from -Ip)"
  foreach ($value in $OperatorValues) {
    $current = [Environment]::GetEnvironmentVariable($value.Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($current)) {
      Write-Refusal "$($value.Name) is missing or empty. A release build without it closes on launch."
      $failures++
      continue
    }
    $bad = switch ($value.Kind) {
      'url' { -not (Test-AbsoluteUrl $current) }
      'scheme' { $current -cnotmatch '^[a-z][a-z0-9+.-]*$' }
      default { $false }
    }
    if ($bad) {
      Write-Refusal "$($value.Name) = '$current' is not a valid $($value.Kind)."
      $failures++
    } else {
      Write-Ok "$($value.Name) = $current"
    }
  }
  $redirects = [Environment]::GetEnvironmentVariable($OptionalUrlList, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($redirects)) {
    foreach ($entry in ($redirects -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })) {
      $uri = $null
      if (-not [Uri]::TryCreate($entry, [UriKind]::Absolute, [ref]$uri)) {
        Write-Refusal "$OptionalUrlList has '$entry', which is not a URL."
        $failures++
      }
    }
  }
  foreach ($name in $MustBeUnset) {
    $current = [Environment]::GetEnvironmentVariable($name, 'Process')
    # FE-D16. -CoachingCheck allows Coaching ON, and only as exactly 'true'. The APK is then named
    # -coaching-check, never the demo name. Recording stays refused either way.
    if ($CoachingCheck -and $name -eq 'EXPO_PUBLIC_COACHING_ENABLED') {
      if ($current -eq 'true') {
        Write-Ok "$name = true (-CoachingCheck: NOT a demo build; the APK is named -coaching-check)"
      } else {
        Write-Refusal "-CoachingCheck needs $name set to exactly 'true' (it is '$current')."
        $failures++
      }
      continue
    }
    if (-not [string]::IsNullOrWhiteSpace($current)) {
      Write-Refusal "$name is set ('$current'). Coaching stays hidden and recording off in a demo build: unset it."
      $failures++
    }
  }

  # W2-B B3. The mock check that stood here ("only Day end needs it") is gone: Day end left the
  # mock in #13, and no file under apps/field/app or apps/field/src imports the mock client any
  # more. Checking a server nothing calls taught the reader that the demo needs it.

  return $failures
}

function Set-CmakePin {
  $gradle = Join-Path $AndroidDir 'app\build.gradle'
  $text = [IO.File]::ReadAllText($gradle)
  if ($text -notmatch [regex]::Escape($CmakePin)) {
    $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
    $pattern = '(?m)^android \{\r?\n'
    if ($text -notmatch $pattern) { throw "no top-level 'android {' block in $gradle" }
    $comment = '    // FE-D8 build-demo-apk.ps1 -- docs/gotchas.md: CMake 3.22.1''s ninja is not long-path aware.'
    $text = [regex]::new($pattern).Replace($text, "android {$newline$comment$newline    $CmakePin$newline", 1)
    [IO.File]::WriteAllText($gradle, $text, (New-Object System.Text.UTF8Encoding $false))
  }
  # Verify from disk, not from the string just written.
  $check = [IO.File]::ReadAllText($gradle)
  if ($check -notmatch "externalNativeBuild\s*\{\s*cmake\s*\{\s*version\s*'$([regex]::Escape($CmakeVersion))'") {
    throw "the CMake $CmakeVersion pin is not in $gradle after applying it"
  }
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
  $dump = { param([string]$Arguments) & cmd.exe /d /c "`"$aapt2`" $Arguments `"$Apk`" 2>nul" }

  $label = (& $dump 'dump badging' | Where-Object { $_ -match "^application-label:'" }) -replace "^application-label:'(.*)'$", '$1'
  if ($label -notmatch '\(demo\)$') { throw "display name is '$label', which does not end in '(demo)'" }
  Write-Ok "display name: $label"

  $resources = & $dump 'dump resources'
  $index = [array]::FindIndex([string[]]$resources, [Predicate[string]] { param($l) $l -match 'xml/network_security_config$' })
  if ($index -lt 0) { throw 'the APK has no network_security_config' }
  $file = ($resources[$index + 1] | Select-String -Pattern 'res/\S+\.xml').Matches[0].Value
  $tree = & $dump "dump xmltree --file $file"
  $hosts = @($tree | Where-Object { $_ -match "^\s*T: '(.+)'$" } | ForEach-Object { $_ -replace "^\s*T: '(.+)'$", '$1' })
  if ($hosts.Count -ne 1 -or $hosts[0] -ne $Ip) {
    throw "the network security config allows [$($hosts -join ', ')], not exactly $Ip"
  }
  $baseOff = ($tree -join "`n") -match 'base-config[^\n]*\n\s*A: cleartextTrafficPermitted=false'
  if (-not $baseOff) { throw 'the network security config does not turn cleartext off for every other host' }
  Write-Ok "cleartext allowed to exactly: $Ip (every other host blocked)"

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
  if (-not $bundle.Contains("http://${Ip}:54321")) { throw "the JS bundle does not contain http://${Ip}:54321" }
  Write-Ok "the JS bundle contains http://${Ip}:54321"
}

function Invoke-Build {
  $commit = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
  $logDir = Join-Path $env:TEMP 'build-demo-apk'
  $null = New-Item -ItemType Directory -Force -Path $logDir

  if ([string]::IsNullOrWhiteSpace($env:ANDROID_HOME)) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  if (-not (Test-Path $env:ANDROID_HOME)) { throw "ANDROID_HOME ($env:ANDROID_HOME) does not exist" }
  # JDK 22+ refuses restricted native access during the CMake configure (docs/gotchas.md).
  $javaVersion = (& cmd.exe /d /c 'java -version 2>&1' | Select-Object -First 1)
  if ($javaVersion -match 'version "(\d+)') {
    if ([int]$Matches[1] -ge 22) { $env:JAVA_TOOL_OPTIONS = '--enable-native-access=ALL-UNNAMED' }
  }

  Write-Step "Clean prebuild with DEMO_CLEARTEXT_HOSTS=$Ip (regenerates the gitignored android folder)"
  $env:DEMO_CLEARTEXT_HOSTS = $Ip
  $log = Join-Path $logDir 'prebuild.log'
  if ((Invoke-Native $AppDir 'npx expo prebuild --platform android --no-install --clean' $log) -ne 0) {
    Get-Content $log -Tail 30 | ForEach-Object { Write-Host "      $_" }
    throw "prebuild failed; full log: $log"
  }
  if ((Get-GitDirt).Count -gt 0) { throw 'prebuild changed tracked files; the build would not match the commit' }
  Write-Ok 'prebuild done; no tracked file changed'

  Write-Step "Applying the CMake $CmakeVersion pin (prebuild removes it)"
  Set-CmakePin
  Write-Ok 'pin present in android\app\build.gradle'

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

  Write-Step 'Verifying the APK'
  Test-Apk $apk

  if ((& git -C $RepoRoot rev-parse --short HEAD).Trim() -ne $commit) { throw 'HEAD moved during the build' }

  Write-Step "Copying to $DemoApkDir (never overwriting)"
  $null = New-Item -ItemType Directory -Force -Path $DemoApkDir
  $date = Get-Date -Format 'yyyy-MM-dd'
  $suffix = if ($CoachingCheck) { '-coaching-check' } else { '' }
  $target = Join-Path $DemoApkDir "field-force-demo-$Ip-$date-$commit$suffix.apk"
  if (Test-Path $target) { throw "$target already exists; not overwriting it. Move it aside yourself if you mean to replace it." }
  [IO.File]::Copy($apk, $target, $false)

  $size = (Get-Item $target).Length
  Write-Host ''
  if ($CoachingCheck) {
    Write-Host 'COACHING-CHECK APK READY: Coaching is ON. NOT FOR THE DEMO.' -ForegroundColor Yellow
  } else {
    Write-Host 'DEMO APK READY' -ForegroundColor Green
  }
  Write-Host "  path:   $target"
  # Invariant culture: on this laptop's en-IN culture {0:N0} printed 102,073,371 as "10,20,73,371".
  Write-Host ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '  size:   {0:N0} bytes ({1:N1} MB)', $size, ($size / 1MB)))
  Write-Host "  commit: $commit"
}

$code = 0
try {
  Write-Host "build-demo-apk: -Ip $Ip$(if ($CheckOnly) { ' -CheckOnly' })$(if ($CoachingCheck) { ' -CoachingCheck' })"
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

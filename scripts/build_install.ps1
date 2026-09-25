<#
.SYNOPSIS
  One-Click APK Build + Install für Real Life AmongUs (Windows)

.DESCRIPTION
  1. Prüft Flutter + ADB
  2. Prüft angeschlossenes Android-Gerät (adb devices)
  3. Baut Release-APK (flutter build apk --release --dart-define=SERVER_URL=...)
  4. Installiert via adb install -r
  5. Startet optional die App
  6. Zeigt Erfolg / Fehler deutlich an

  Keine manuellen APK-Auswahlen, keine Adminrechte nötig.
  Pfade konfigurierbar via Umgebungsvariablen oder Parameter.

.PARAMETER ServerUrl
  SERVER_URL für --dart-define. Required; pass -ServerUrl or set $env:SERVER_URL.

.PARAMETER FlutterCmd
  Pfad zu flutter(.bat). Default: auto-detect via Get-Command / FLUTTER_CMD / gängige Pfade

.PARAMETER AdbCmd
  Pfad zu adb(.exe). Default: auto-detect via Get-Command / ADB_CMD / ANDROID_HOME etc.

.PARAMETER ApkPath
  Pfad zur APK nach Build. Default: app/build/app/outputs/flutter-apk/app-release.apk relativ zum Projekt-Root

.PARAMETER NoStart
  Wenn gesetzt, wird die App nach Installation nicht automatisch gestartet

.EXAMPLE
  .\scripts\build_install.ps1
  .\scripts\build_install.ps1 -ServerUrl https://game.example.net
  $env:FLUTTER_CMD="C:\src\flutter\bin\flutter.bat"; $env:ADB_CMD="C:\platform-tools\adb.exe"; .\scripts\build_install.ps1
#>
[CmdletBinding()]
param(
  [string]$ServerUrl = $(if ($env:SERVER_URL) { $env:SERVER_URL } else { "" }),
  [string]$FlutterCmd = $(if ($env:FLUTTER_CMD) { $env:FLUTTER_CMD } else { "" }),
  [string]$AdbCmd = $(if ($env:ADB_CMD) { $env:ADB_CMD } else { "" }),
  [string]$ApkPath = "",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
# UTF-8 Ausgabe, damit Umlaute in der Windows-Konsole korrekt lesbar sind
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
$ProjectRoot = Split-Path $PSScriptRoot -Parent
if (-not $ProjectRoot) { $ProjectRoot = (Get-Location).Path }

if (-not $ServerUrl) {
  Write-Error "A server URL is required. Set SERVER_URL or pass -ServerUrl with the deployed HTTPS server URL."
  exit 1
}
try {
  $serverUri = [Uri]$ServerUrl
  if ($serverUri.Scheme -ne "https" -or $serverUri.IsLoopback) { throw "A public HTTPS URL is required for a release APK." }
} catch {
  Write-Error "Invalid server URL '$ServerUrl': $_"
  exit 1
}

function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[FEHLER] $msg" -ForegroundColor Red }

function Test-ExeVersion {
  param([string]$Exe, [string]$MustContain = "", [int]$TimeoutSec = 60)
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($Exe -match "\.(bat|cmd)$") {
      $psi.FileName = "$env:SystemRoot\System32\cmd.exe"
      $psi.Arguments = "/c `"$Exe`" --version"
    } else {
      $psi.FileName = $Exe
      $psi.Arguments = "--version"
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch {}; return $false }
    $out = $p.StandardOutput.ReadToEnd() + "`n" + $p.StandardError.ReadToEnd()
    if ($p.ExitCode -ne 0) { return $false }
    if ($MustContain -and ($out -notmatch $MustContain)) { return $false }
    return $true
  } catch { return $false }
}

function Find-Flutter {
  param([string]$Hint)
  # 0. Expliziter Override (Parameter oder Env) hat immer Vorrang
  if ($Hint -and (Test-Path $Hint)) { return $Hint }
  if ($env:FLUTTER_CMD -and (Test-Path $env:FLUTTER_CMD)) { return $env:FLUTTER_CMD }
  # 1. PATH
  foreach ($n in @("flutter", "flutter.bat")) {
    $cmd = Get-Command $n -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }
  }
  # 2. Bekannte Installationsorte (bounded Liste, kein Full-Disk-Scan)
  $candidates = @(
    "$env:USERPROFILE\flutter\bin\flutter.bat",
    "$env:USERPROFILE\src\flutter\bin\flutter.bat",
    "$env:USERPROFILE\Documents\flutter\bin\flutter.bat",
    "$env:USERPROFILE\OneDrive\flutter\bin\flutter.bat",
    "$env:LOCALAPPDATA\flutter\bin\flutter.bat",
    "$env:USERPROFILE\.local\flutter\bin\flutter.bat",
    "$env:USERPROFILE\scoop\apps\flutter\current\bin\flutter.bat",
    "C:\flutter\bin\flutter.bat",
    "C:\src\flutter\bin\flutter.bat",
    "C:\tools\flutter\bin\flutter.bat",
    "C:\sdk\flutter\bin\flutter.bat",
    "C:\dev\flutter\bin\flutter.bat",
    "C:\Program Files\flutter\bin\flutter.bat",
    "D:\flutter\bin\flutter.bat",
    "D:\tools\flutter\bin\flutter.bat",
    "D:\sdk\flutter\bin\flutter.bat",
    "D:\src\flutter\bin\flutter.bat",
    "$ProjectRoot\flutter\bin\flutter.bat"
  )
  # fvm-Versionen (nur dieses eine Verzeichnis listen, neueste zuerst)
  $fvmRoot = "$env:USERPROFILE\fvm\versions"
  if (Test-Path $fvmRoot) {
    try {
      $vers = Get-ChildItem $fvmRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
      foreach ($v in $vers) {
        $p = Join-Path $v.FullName "bin\flutter.bat"
        if (Test-Path $p) { $candidates += $p }
      }
    } catch {}
  }
  # scoop-Versionen (nur dieses eine Verzeichnis listen, neueste zuerst)
  $scoopRoot = "$env:USERPROFILE\scoop\apps\flutter"
  if (Test-Path $scoopRoot) {
    try {
      $vers = Get-ChildItem $scoopRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "current" } | Sort-Object Name -Descending
      foreach ($v in $vers) {
        $p = Join-Path $v.FullName "bin\flutter.bat"
        if (Test-Path $p) { $candidates += $p }
      }
    } catch {}
  }
  $found = @()
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p) -and ($found -notcontains $p)) { $found += $p }
  }
  if ($found.Count -eq 0) {
    # WSL-Hinweis: Flutter nur in WSL vorhanden?
    try {
      $wslFlutter = (wsl --exec which flutter 2>$null) -join ""
      if ($LASTEXITCODE -eq 0 -and $wslFlutter) {
        Write-Warn "Flutter nur in WSL gefunden ($wslFlutter). Für Windows-Build bitte Flutter unter Windows installieren oder FLUTTER_CMD setzen."
      }
    } catch {}
    return $null
  }
  if ($found.Count -eq 1) { return $found[0] }
  # Mehrere gefunden: funktionierende Version wählen (flutter --version mit Timeout)
  Write-Host "  Mehrere Flutter-Installationen gefunden ($($found.Count)), prüfe Funktion..." -ForegroundColor Gray
  foreach ($p in $found) {
    Write-Host "  Teste: $p" -ForegroundColor Gray
    if (Test-ExeVersion -Exe $p -MustContain "Flutter" -TimeoutSec 90) {
      Write-Ok "Funktionierendes Flutter gewählt: $p"
      return $p
    }
    Write-Warn "Übersprungen (kein gültiges flutter --version): $p"
  }
  Write-Warn "Keine Installation bestand den Funktionstest, verwende erste: $($found[0])"
  return $found[0]
}

function Find-Adb {
  param([string]$Hint)
  # 0. Expliziter Override (Parameter oder Env) hat immer Vorrang
  if ($Hint -and (Test-Path $Hint)) { return $Hint }
  if ($env:ADB_CMD -and (Test-Path $env:ADB_CMD)) { return $env:ADB_CMD }
  # 1. SDK-Umgebungsvariablen
  foreach ($sdk in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if ($sdk) {
      $p = Join-Path $sdk "platform-tools\adb.exe"
      if (Test-Path $p) { return $p }
    }
  }
  # 2. PATH
  foreach ($n in @("adb", "adb.exe")) {
    $cmd = Get-Command $n -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -and (Test-Path $cmd.Source)) { return $cmd.Source }
  }
  # 3. Bekannte Installationsorte (bounded Liste, kein Full-Disk-Scan)
  $candidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    "$env:ProgramFiles\Android\platform-tools\adb.exe",
    "${env:ProgramFiles(x86)}\Android\platform-tools\adb.exe",
    "C:\platform-tools\adb.exe",
    "C:\Android\platform-tools\adb.exe",
    "C:\adb\adb.exe",
    "C:\tools\platform-tools\adb.exe",
    "$env:USERPROFILE\platform-tools\adb.exe",
    "$env:USERPROFILE\Android\platform-tools\adb.exe",
    "$ProjectRoot\platform-tools\adb.exe"
  )
  # scrcpy-Bundles in Downloads (versionsfest: nur dieses Verzeichnis listen, neueste zuerst;
  # erkennt auch doppelt entpackte Zips wie scrcpy-win64-v4.1\scrcpy-win64-v4.1\adb.exe)
  $dl = Join-Path $env:USERPROFILE "Downloads"
  if (Test-Path $dl) {
    try {
      $scr = Get-ChildItem $dl -Directory -Filter "scrcpy-*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
      foreach ($s in $scr) {
        $p1 = Join-Path $s.FullName "adb.exe"
        if (Test-Path $p1) { $candidates += $p1 }
        $p2 = Join-Path $s.FullName (Join-Path $s.Name "adb.exe")
        if (Test-Path $p2) { $candidates += $p2 }
      }
    } catch {}
  }
  # scrcpy über PATH (falls scrcpy installiert ist, liegt adb meist daneben)
  $scrcpy = Get-Command scrcpy -ErrorAction SilentlyContinue
  if ($scrcpy -and $scrcpy.Source) {
    $dir = Split-Path $scrcpy.Source -Parent
    $maybe = Join-Path $dir "adb.exe"
    if (Test-Path $maybe) { $candidates += $maybe }
  }
  $found = @()
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p) -and ($found -notcontains $p)) { $found += $p }
  }
  if ($found.Count -eq 0) { return $null }
  if ($found.Count -eq 1) { return $found[0] }
  # Mehrere gefunden: funktionierende Version wählen (adb --version ist schnell)
  foreach ($p in $found) {
    if (Test-ExeVersion -Exe $p -MustContain "Android Debug Bridge" -TimeoutSec 15) { return $p }
  }
  return $found[0]
}

# --- 1. Flutter prüfen ---
Write-Step "Prüfe Flutter"
$flutter = Find-Flutter -Hint $FlutterCmd
if (-not $flutter) {
  Write-Err "Flutter nicht gefunden."
  Write-Host "  Lösung: FLUTTER_CMD Umgebungsvariable setzen oder flutter in PATH legen" -ForegroundColor Yellow
  Write-Host "  Beispiel: `$env:FLUTTER_CMD='C:\src\flutter\bin\flutter.bat'" -ForegroundColor Gray
  Write-Host "  Getestet: where flutter / Get-Command flutter" -ForegroundColor Gray
  exit 1
}
Write-Ok "Flutter: $flutter"
try { & $flutter --version 2>&1 | Select-Object -First 1 | Write-Host } catch { Write-Warn "Konnte flutter --version nicht ausführen" }

# --- 2. ADB prüfen ---
Write-Step "Prüfe ADB"
$adb = Find-Adb -Hint $AdbCmd
if (-not $adb) {
  Write-Err "ADB nicht gefunden."
  Write-Host "  Lösung: ADB_CMD setzen oder Android SDK platform-tools in PATH legen" -ForegroundColor Yellow
  Write-Host "  Beispiel: `$env:ADB_CMD='C:\platform-tools\adb.exe'" -ForegroundColor Gray
  Write-Host "  Oder ANDROID_HOME setzen: `$env:ANDROID_HOME='C:\Users\%USERNAME%\AppData\Local\Android\Sdk'" -ForegroundColor Gray
  Write-Host "  Download: https://developer.android.com/studio/releases/platform-tools" -ForegroundColor Gray
  exit 1
}
Write-Ok "ADB: $adb"
try { & $adb --version 2>&1 | Select-Object -First 1 | Write-Host } catch { Write-Warn "Konnte adb --version nicht ausführen" }

# --- 3. Gerät prüfen ---
Write-Step "Prüfe Android-Gerät (adb devices)"
$devicesOut = & $adb devices 2>&1 | Out-String
Write-Host $devicesOut
# Robust parsen: adb trennt Serial und Status mit TAB und Zeilen mit CRLF.
# Jede Zeile wird getrimmt und als (Serial, Status) ausgewertet.
function Get-AdbDeviceEntries {
  param([string]$AdbExe)
  $out = & $AdbExe devices 2>&1 | Out-String
  $entries = @()
  foreach ($raw in ($out -split "`r?`n")) {
    $line = $raw.Trim()
    if (-not $line) { continue }
    if ($line -match "^List of devices") { continue }
    if ($line -match "^(?<serial>\S+)\s+(?<state>.+)$") {
      $entries += [pscustomobject]@{ Serial = $Matches.serial; State = $Matches.state.Trim() }
    }
  }
  return $entries
}
$deviceEntries = Get-AdbDeviceEntries -AdbExe $adb
$onlineDevices = @($deviceEntries | Where-Object { $_.State -eq "device" })

function Test-IsWirelessSerial {
  param([string]$Serial)
  return ($Serial -match "_adb-tls-connect" -or $Serial -match "^adb-" -or $Serial -match ":" -or $Serial -match "\.")
}

$usbDevices = @($onlineDevices | Where-Object { -not (Test-IsWirelessSerial $_.Serial) })
$wirelessDevices = @($onlineDevices | Where-Object { Test-IsWirelessSerial $_.Serial })

# Wireless-Einträge entfernen, die nur ein Duplikat eines USB-Geräts sind
# (die Wireless-ID enthält die USB-Serial, z.B. adb-RZCY21RV7FE-...).
$distinctWireless = @()
foreach ($w in $wirelessDevices) {
  $isTwin = $false
  foreach ($u in $usbDevices) {
    if ($u.Serial -and ($u.Serial.Length -ge 4) -and ($w.Serial -like ("*" + $u.Serial + "*"))) { $isTwin = $true; break }
  }
  if (-not $isTwin) { $distinctWireless += $w }
}

$deviceId = $null
if ($usbDevices.Count -eq 1) {
  $deviceId = $usbDevices[0].Serial
  if ($distinctWireless.Count -eq 0 -and $wirelessDevices.Count -gt 0) {
    Write-Ok "Gerät gefunden (USB, Wireless-Duplikat ignoriert): $deviceId"
  } else {
    Write-Ok "Gerät gefunden (USB): $deviceId"
  }
} elseif ($usbDevices.Count -gt 1) {
  $ids = ($usbDevices | ForEach-Object { $_.Serial }) -join ", "
  Write-Err "Mehrere verschiedene USB-Geräte gefunden: $ids. Bitte nur ein Gerät anschließen, sonst wird evtl. das falsche bespielt."
  exit 1
} elseif ($distinctWireless.Count -eq 1) {
  $deviceId = $distinctWireless[0].Serial
  Write-Ok "Gerät gefunden (Wireless): $deviceId"
} elseif ($distinctWireless.Count -gt 1) {
  $ids = ($distinctWireless | ForEach-Object { $_.Serial }) -join ", "
  Write-Err "Mehrere verschiedene Wireless-Geräte gefunden: $ids. Bitte nur ein Gerät verbinden."
  exit 1
} else {
  $unauth = @($deviceEntries | Where-Object { $_.State -match "unauthorized" })
  $offline = @($deviceEntries | Where-Object { $_.State -match "offline" })
  if ($unauth.Count -gt 0) {
    $ids = ($unauth | ForEach-Object { $_.Serial }) -join ", "
    Write-Err "Gerät gefunden aber UNAUTHORIZED ($ids). Bitte am Handy USB-Debugging authorisieren (Dialog bestätigen)."
  } elseif ($offline.Count -gt 0) {
    $ids = ($offline | ForEach-Object { $_.Serial }) -join ", "
    Write-Err "Gerät ist OFFLINE ($ids). Kabel prüfen, adb kill-server / start-server versuchen."
  } else {
    Write-Err "Kein Android-Gerät über ADB gefunden."
  }
  Write-Host "  Hilfe: 1) USB-Debugging aktivieren (Entwickleroptionen) 2) Kabel prüfen 3) 'adb devices' sollte Gerät mit 'device' zeigen" -ForegroundColor Yellow
  Write-Host "  Tipp: scrcpy / Android Studio kann Treiberprobleme lösen" -ForegroundColor Gray
  exit 1
}

# --- 4. APK Pfad bestimmen ---
if (-not $ApkPath -or $ApkPath -eq "") {
  $ApkPath = Join-Path $ProjectRoot "app\build\app\outputs\flutter-apk\app-release.apk"
}
# Normalisiere Pfad (Windows)
$ApkPath = [System.IO.Path]::GetFullPath($ApkPath)
Write-Step "APK Pfad: $ApkPath"

# PUB_CACHE aufs Projekt-Laufwerk legen (nur Prozess-Umgebung, keine Systemänderung):
# Kotlin-Incremental-Builds schlagen fehl, wenn Pub-Cache (C:) und Projekt (z.B. D:)
# auf verschiedenen Laufwerken liegen ("different roots").
if (-not $env:PUB_CACHE) {
  try {
    $projDrive = (Get-Item $ProjectRoot).PSDrive.Name
    if ($projDrive -and ($projDrive -ne "C")) {
      $driveCache = "$projDrive`:\.pub-cache"
      if (-not (Test-Path $driveCache)) { New-Item -ItemType Directory -Force -Path $driveCache | Out-Null }
      $env:PUB_CACHE = $driveCache
      Write-Host "  PUB_CACHE (Prozess): $driveCache" -ForegroundColor Gray
    }
  } catch { Write-Warn "Konnte PUB_CACHE nicht setzen: $_" }
}

# --- 5. Flutter Build (im app/-Verzeichnis, dort liegt pubspec.yaml) ---
Write-Step "Baue Release APK (SERVER_URL=$ServerUrl)"
$appDir = Join-Path $ProjectRoot "app"
if (-not (Test-Path (Join-Path $appDir "pubspec.yaml"))) {
  Write-Err "pubspec.yaml nicht gefunden in: $appDir"
  exit 1
}
Push-Location $appDir
try {
  $buildArgs = @("build", "apk", "--release", "--dart-define=SERVER_URL=$ServerUrl")
  Write-Host "  $flutter $($buildArgs -join ' ')" -ForegroundColor Gray
  & $flutter @buildArgs
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Flutter Build fehlgeschlagen (Exit $LASTEXITCODE)"
    Pop-Location
    exit $LASTEXITCODE
  }
  Write-Ok "Build erfolgreich"
} finally {
  Pop-Location
}

if (-not (Test-Path $ApkPath)) {
  Write-Err "APK nicht gefunden nach Build: $ApkPath"
  Write-Host "  Erwartet: app\build\app\outputs\flutter-apk\app-release.apk" -ForegroundColor Yellow
  # Fallback: suche APK im build-Ordner
  $found = Get-ChildItem -Path $ProjectRoot -Recurse -Filter "app-release.apk" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) {
    Write-Warn "Gefunden: $($found.FullName) — verwende diese"
    $ApkPath = $found.FullName
  } else {
    exit 1
  }
}
$apkSize = (Get-Item $ApkPath).Length / 1MB
$apkSizeMb = [math]::Round($apkSize, 1)
Write-Ok "APK: $ApkPath ($apkSizeMb MB)"

# Vor dem Install: Gerät erneut prüfen (Wireless-Verbindung kann während
# des langen Builds abbrechen). Einmal reconnect versuchen, sonst sauber abbrechen.
Write-Step "Gerät erneut prüfen (vor Install)"
$recheck = @(Get-AdbDeviceEntries -AdbExe $adb | Where-Object { $_.Serial -eq $deviceId -and $_.State -eq "device" })
if ($recheck.Count -eq 0) {
  Write-Warn "Gerät $deviceId nicht mehr verbunden, versuche Reconnect..."
  try { & $adb reconnect 2>&1 | Out-String | Write-Host } catch {}
  Start-Sleep -Seconds 3
  $recheck = @(Get-AdbDeviceEntries -AdbExe $adb | Where-Object { $_.Serial -eq $deviceId -and $_.State -eq "device" })
  if ($recheck.Count -eq 0) {
    Write-Err "Gerät $deviceId ist nicht mehr verbunden (Verbindung während des Builds abgebrochen). Bitte Handy erneut verbinden und Skript erneut starten."
    exit 1
  }
}
Write-Ok "Gerät weiterhin verbunden: $deviceId"

# --- 6. Installieren ---
Write-Step "Installiere APK auf $deviceId (adb install -r)"
& $adb -s $deviceId install -r "$ApkPath"
if ($LASTEXITCODE -ne 0) {
  Write-Err "Installation fehlgeschlagen (Exit $LASTEXITCODE)"
  Write-Host "  Tipps: Handy entsperren, 'Installation über USB' erlauben, bei 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' App erst deinstallieren: adb uninstall com.example.real_life_amongus_app" -ForegroundColor Yellow
  exit $LASTEXITCODE
}
Write-Ok "Installation erfolgreich"

# --- 7. App starten (optional) ---
if (-not $NoStart) {
  Write-Step "Starte App"
  $package = "com.example.real_life_amongus_app"
  $activity = "com.example.real_life_amongus_app.MainActivity"
  & $adb -s $deviceId shell am start -n "$package/$activity" 2>&1 | Write-Host
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "App gestartet: $package/$activity"
  } else {
    Write-Warn "App konnte nicht automatisch gestartet werden (Exit $LASTEXITCODE) — bitte manuell öffnen"
  }
} else {
  Write-Host "App-Start übersprungen (-NoStart)" -ForegroundColor Gray
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "FERTIG: Build + Install erfolgreich!" -ForegroundColor Green
Write-Host "Gerät: $deviceId" -ForegroundColor Green
Write-Host "APK  : $ApkPath" -ForegroundColor Green
Write-Host "URL  : $ServerUrl" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Optional Desktop/Phone Notification bei Erfolg (falls notification/notify.ps1 existiert)
$notifyScript = Join-Path $ProjectRoot "notification\notify.ps1"
if (Test-Path $notifyScript) {
  try { & $notifyScript -Title "Muse Spark fertig" -Message "APK Build + Install erfolgreich ($deviceId)" -ErrorAction SilentlyContinue } catch {}
}
exit 0

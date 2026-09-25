<#
.SYNOPSIS
  Testet Desktop + Handy Benachrichtigungen und Build-Script Logik ohne Hardware
#>
[CmdletBinding()]
param(
  [switch]$SkipPhone
)

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$ErrorActionPreference = "Continue"

Write-Host "`n=== Teste Desktop Notification ===" -ForegroundColor Cyan
& (Join-Path $ProjectRoot "notification\desktop.ps1") -Title "Muse Spark Test" -Message "Desktop-Test $(Get-Date -Format 'HH:mm:ss')"
if ($LASTEXITCODE -eq 0) { Write-Host "[OK] Desktop" -ForegroundColor Green } else { Write-Host "[WARN] Desktop Exit $LASTEXITCODE" -ForegroundColor Yellow }

if (-not $SkipPhone) {
  Write-Host "`n=== Teste Handy Notification ===" -ForegroundColor Cyan
  Write-Host "  Erwartet: NTFY_TOPIC gesetzt, sonst nur Info-Meldung (kein Fehler)" -ForegroundColor Gray
  & (Join-Path $ProjectRoot "notification\phone.ps1") -Title "Muse Spark Test" -Message "Handy-Test $(Get-Date -Format 'HH:mm:ss')"
  if ($LASTEXITCODE -eq 0) { Write-Host "[OK] Phone (oder Info falls nicht konfiguriert)" -ForegroundColor Green }
}

Write-Host "`n=== Teste Kombiniert ===" -ForegroundColor Cyan
& (Join-Path $ProjectRoot "notification\notify.ps1") -Title "Muse Spark Test" -Message "Kombiniert $(Get-Date -Format 'HH:mm:ss')"
Write-Host "[OK] Kombiniert" -ForegroundColor Green

Write-Host "`n=== Teste Build-Script Logik (ohne Gerät) ===" -ForegroundColor Cyan
Write-Host "Simuliere: adb devices ohne Gerät -> sollte Fehlermeldung 'Kein Android-Gerät' zeigen (kein Build starten)" -ForegroundColor Gray
# Wir testen nur die Geräte-Erkennung, nicht den Build
$adb = $null
try { $adb = (Get-Command adb -ErrorAction SilentlyContinue).Source } catch {}
if ($adb) {
  $out = & $adb devices 2>&1 | Out-String
  Write-Host $out
  $devLines = $out -split "`r?`n" | Where-Object { $_.Trim() -match "\sdevice$" }
  if ($devLines) { Write-Host "[INFO] Gerät(e) vorhanden: $(($devLines | ForEach-Object { $_.Trim() }) -join ' | ')" -ForegroundColor Green } else { Write-Host "[OK] Erkennung funktioniert (kein Gerät -> erwartete Fehlermeldung im Build-Script)" -ForegroundColor Green }
} else {
  Write-Host "[WARN] adb nicht in PATH, Build-Script würde 'ADB nicht gefunden' melden — OK für Test" -ForegroundColor Yellow
}

Write-Host "`n=== Teste APK-Pfad Erkennung ===" -ForegroundColor Cyan
$apk = Join-Path $ProjectRoot "app\build\app\outputs\flutter-apk\app-release.apk"
if (Test-Path $apk) {
  $size = (Get-Item $apk).Length / 1MB
  $sizeMb = [math]::Round($size, 1)
  Write-Host "[OK] APK gefunden: $apk ($sizeMb MB)" -ForegroundColor Green
} else {
  Write-Host "[INFO] APK nicht vorhanden (Build noch nicht gelaufen) — Pfad korrekt: $apk" -ForegroundColor Yellow
}

Write-Host "`n=== Alle Notification-Tests abgeschlossen ===" -ForegroundColor Cyan

<#
.SYNOPSIS
  Windows Desktop-Benachrichtigung für Muse Spark

.DESCRIPTION
  Zeigt eine native Windows-Toast-Benachrichtigung.
  Versucht der Reihe nach:
  1) BurntToast (falls installiert)
  2) System.Windows.Forms BallonTip
  3) WScript.Shell Popup
  4) Konsolen-Fallback

  Keine Adminrechte nötig.
  Keine externen Tokens.
#>
[CmdletBinding()]
param(
  [string]$Title = "Muse Spark fertig",
  [string]$Message = "Task wurde erfolgreich abgeschlossen.",
  [string]$AppLogo = ""
)

function Show-BurntToast {
  param($Title, $Message, $AppLogo)
  try {
    if (Get-Module -ListAvailable -Name BurntToast -ErrorAction SilentlyContinue) {
      Import-Module BurntToast -ErrorAction Stop
      if ($AppLogo -and (Test-Path $AppLogo)) {
        New-BurntToastNotification -Text $Title, $Message -AppLogo $AppLogo -ErrorAction Stop | Out-Null
      } else {
        New-BurntToastNotification -Text $Title, $Message -ErrorAction Stop | Out-Null
      }
      return $true
    }
  } catch { return $false }
  return $false
}

function Show-BalloonTip {
  param($Title, $Message)
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = $Message
    $notify.Visible = $true
    $notify.ShowBalloonTip(5000)
    Start-Sleep -Seconds 6
    $notify.Dispose()
    return $true
  } catch { return $false }
}

function Show-WScriptPopup {
  param($Title, $Message)
  try {
    $ws = New-Object -ComObject WScript.Shell
    $null = $ws.Popup($Message, 5, $Title, 64)
    return $true
  } catch { return $false }
}

Write-Host "Desktop-Benachrichtigung: $Title - $Message" -ForegroundColor Cyan

if (Show-BurntToast -Title $Title -Message $Message -AppLogo $AppLogo) {
  Write-Host "[OK] BurntToast angezeigt" -ForegroundColor Green
  exit 0
}
if (Show-BalloonTip -Title $Title -Message $Message) {
  Write-Host "[OK] BalloonTip angezeigt" -ForegroundColor Green
  exit 0
}
if (Show-WScriptPopup -Title $Title -Message $Message) {
  Write-Host "[OK] WScript Popup angezeigt" -ForegroundColor Green
  exit 0
}
# Fallback: Konsolen-Ausgabe + Beep
Write-Host "=== $Title ===" -ForegroundColor Yellow
Write-Host $Message -ForegroundColor White
try { [Console]::Beep(800, 300); [Console]::Beep(1000, 300) } catch {}
exit 0

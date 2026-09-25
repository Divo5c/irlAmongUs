<#
.SYNOPSIS
  Muse Spark Fertig — kombinierte Benachrichtigung (Desktop + Handy)

.DESCRIPTION
  Ruft desktop.ps1 und phone.ps1 auf.
  Wird von build_install.ps1 und vom opencode-Plugin verwendet.

  Keine Secrets hardcoden, nur Env/Config.
#>
[CmdletBinding()]
param(
  [string]$Title = "Muse Spark fertig",
  [string]$Message = "Task wurde erfolgreich abgeschlossen.",
  [string]$Priority = "high"
)

$PSScriptRootActual = $PSScriptRoot
if (-not $PSScriptRootActual) { $PSScriptRootActual = Split-Path $MyInvocation.MyCommand.Path -Parent }

$desktop = Join-Path $PSScriptRootActual "desktop.ps1"
$phone = Join-Path $PSScriptRootActual "phone.ps1"

if (Test-Path $desktop) {
  try { & $desktop -Title $Title -Message $Message } catch { Write-Host "[WARN] Desktop-Notify fehlgeschlagen: $_" -ForegroundColor Yellow }
} else {
  Write-Host "[WARN] desktop.ps1 nicht gefunden: $desktop" -ForegroundColor Yellow
}

if (Test-Path $phone) {
  try { & $phone -Title $Title -Message $Message -Priority $Priority } catch { Write-Host "[WARN] Phone-Notify fehlgeschlagen: $_" -ForegroundColor Yellow }
} else {
  Write-Host "[WARN] phone.ps1 nicht gefunden: $phone" -ForegroundColor Yellow
}

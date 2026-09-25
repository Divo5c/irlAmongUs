<#
.SYNOPSIS
  Wrapper für `opencode run` mit zuverlässiger Fertig-Erkennung via Process-Exit

.DESCRIPTION
  Startet `opencode run <args>` und sendet nach Exit (egal ob Erfolg/Fehler)
  eine Desktop+Handy Benachrichtigung via notification/notify.ps1.

  Dies ist die zuverlässigste Erkennung (Process-State), unabhängig von
  internen opencode Events. Für TUI (`opencode` ohne `run`) nutze das Plugin
  .opencode/plugin/notify.ts

.EXAMPLE
  .\scripts\opencode-notify.ps1 run "implement feature X"
  .\scripts\opencode-notify.ps1 run --model ollama/gemma4:26b "fix bug"
#>
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$OpencodeArgs
)

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$notify = Join-Path $ProjectRoot "notification\notify.ps1"

# Finde opencode
$opencode = $null
try { $opencode = (Get-Command opencode -ErrorAction SilentlyContinue).Source } catch {}
if (-not $opencode) {
  $candidates = @("$env:USERPROFILE\.opencode\bin\opencode", "$env:USERPROFILE\.local\bin\opencode", "opencode")
  foreach ($c in $candidates) { if (Get-Command $c -ErrorAction SilentlyContinue) { $opencode = $c; break } }
}
if (-not $opencode) { $opencode = "opencode" }

$argStr = ($OpencodeArgs -join " ")
Write-Host "Starte: $opencode $argStr" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  & $opencode @OpencodeArgs
  $exit = $LASTEXITCODE
} catch {
  $exit = 1
  Write-Host "Fehler beim Start: $_" -ForegroundColor Red
}
$sw.Stop()
$duration = "{0:mm\:ss}" -f $sw.Elapsed

if ($exit -eq 0) {
  $title = "Muse Spark fertig"
  $msg = "Task erfolgreich abgeschlossen ($duration). Exit $exit"
  Write-Host "`n$msg" -ForegroundColor Green
} else {
  $title = "Muse Spark fertig (Fehler)"
  $msg = "Task beendet mit Exit $exit ($duration). Args: $argStr"
  Write-Host "`n$msg" -ForegroundColor Yellow
}

if (Test-Path $notify) {
  try { & $notify -Title $title -Message $msg } catch { Write-Host "Notify fehlgeschlagen: $_" -ForegroundColor Yellow }
} else {
  Write-Host "notification/notify.ps1 nicht gefunden, keine Push" -ForegroundColor Gray
}
exit $exit

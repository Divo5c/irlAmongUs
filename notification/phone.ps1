<#
.SYNOPSIS
  Smartphone Push-Benachrichtigung für Muse Spark (austauschbar)

.DESCRIPTION
  Sendet eine Push-Nachricht ans Handy ohne eigene Server-Infrastruktur.
  Standard: ntfy.sh (kostenlos, Open Source, Android App, kein Token nötig)
  Alternativen per Umgebungsvariable erweiterbar.

  Keine Tokens hardcoden! Alles via Env/Config.

  Priorität:
  1) ntfy.sh  -> NTFY_TOPIC (erforderlich), NTFY_SERVER (default https://ntfy.sh), NTFY_USER/NTFY_PASS optional
  2) Webhook  -> WEBHOOK_URL (generischer POST)
  3) Pushover -> PUSHOVER_TOKEN + PUSHOVER_USER
  4) Telegram-> TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID

.PARAMETER Title
  Titel der Nachricht

.PARAMETER Message
  Nachrichtentext

.PARAMETER Priority
  ntfy Priority: min/low/default/high/max

.EXAMPLE
  $env:NTFY_TOPIC="my-spark-abc123"; .\notification\phone.ps1 -Title "Muse Spark fertig" -Message "Build done"

  # Gerne einmalig einrichten:
  # Android: ntfy App installieren -> Topic abonnieren (z.B. my-spark-abc123)
  # Windows: $env:NTFY_TOPIC="my-spark-abc123" in $PROFILE oder notification\config.env setzen
#>
[CmdletBinding()]
param(
  [string]$Title = "Muse Spark fertig",
  [string]$Message = "Task wurde erfolgreich abgeschlossen.",
  [string]$Priority = "high"
)

$ErrorActionPreference = "Continue"

function Send-Ntfy {
  param($Title, $Message, $Priority)
  $topic = $env:NTFY_TOPIC
  if (-not $topic) { $topic = $env:NTFY_TOPIC_NAME }
  if (-not $topic) {
    # Versuche config file: notification/config.env oder .env
    $cfgPaths = @(
      "$PSScriptRoot\config.env",
      "$PSScriptRoot\..\notification\config.env",
      "$(Split-Path $PSScriptRoot -Parent)\notification\config.env",
      "$env:USERPROFILE\.config\ntfy\topic"
    )
    foreach ($p in $cfgPaths) {
      if (Test-Path $p) {
        $content = Get-Content $p -ErrorAction SilentlyContinue | Where-Object { $_ -match "^\s*NTFY_TOPIC\s*=" }
        if ($content) {
          $topic = ($content -split "=",2)[1].Trim().Trim('"').Trim("'")
          if ($topic) { break }
        }
      }
    }
  }
  if (-not $topic) { return $false }

  $server = if ($env:NTFY_SERVER) { $env:NTFY_SERVER } elseif ($env:NTFY_URL) { ($env:NTFY_URL -replace "/[^/]+$","") } else { "https://ntfy.sh" }
  $server = $server.TrimEnd("/")
  $url = "$server/$topic"
  Write-Host "Sende ntfy push -> $url" -ForegroundColor Cyan
  try {
    $headers = @{
      "Title" = $Title
      "Priority" = $Priority
      "Tags" = "sparkles,white_check_mark"
    }
    $auth = $null
    if ($env:NTFY_USER -and $env:NTFY_PASS) {
      $pair = "$($env:NTFY_USER):$($env:NTFY_PASS)"
      $bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
      $auth = "Basic " + [Convert]::ToBase64String($bytes)
      $headers["Authorization"] = $auth
    } elseif ($env:NTFY_TOKEN) {
      $headers["Authorization"] = "Bearer $($env:NTFY_TOKEN)"
    }
    $resp = Invoke-RestMethod -Uri $url -Method Post -Body $Message -Headers $headers -TimeoutSec 10 -ErrorAction Stop
    Write-Host "[OK] ntfy gesendet" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "[WARN] ntfy fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

function Send-Webhook {
  param($Title, $Message)
  $url = $env:WEBHOOK_URL
  if (-not $url) { return $false }
  Write-Host "Sende Webhook -> $url" -ForegroundColor Cyan
  try {
    $body = @{ title = $Title; message = $Message; timestamp = (Get-Date -Format o) } | ConvertTo-Json
    Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop | Out-Null
    Write-Host "[OK] Webhook gesendet" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "[WARN] Webhook fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

function Send-Pushover {
  param($Title, $Message)
  $token = $env:PUSHOVER_TOKEN
  $user = $env:PUSHOVER_USER
  if (-not $token -or -not $user) { return $false }
  Write-Host "Sende Pushover..." -ForegroundColor Cyan
  try {
    $body = @{ token = $token; user = $user; title = $Title; message = $Message; priority = 1 }
    Invoke-RestMethod -Uri "https://api.pushover.net/1/messages.json" -Method Post -Body $body -TimeoutSec 10 -ErrorAction Stop | Out-Null
    Write-Host "[OK] Pushover gesendet" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "[WARN] Pushover fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

function Send-Telegram {
  param($Title, $Message)
  $token = $env:TELEGRAM_BOT_TOKEN
  $chat = $env:TELEGRAM_CHAT_ID
  if (-not $token -or -not $chat) { return $false }
  Write-Host "Sende Telegram..." -ForegroundColor Cyan
  try {
    $text = "$Title`n$Message"
    $url = "https://api.telegram.org/bot$token/sendMessage"
    $body = @{ chat_id = $chat; text = $text }
    Invoke-RestMethod -Uri $url -Method Post -Body $body -TimeoutSec 10 -ErrorAction Stop | Out-Null
    Write-Host "[OK] Telegram gesendet" -ForegroundColor Green
    return $true
  } catch {
    Write-Host "[WARN] Telegram fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

$sent = $false
if (Send-Ntfy -Title $Title -Message $Message -Priority $Priority) { $sent = $true }
if (Send-Webhook -Title $Title -Message $Message) { $sent = $true }
if (Send-Pushover -Title $Title -Message $Message) { $sent = $true }
if (Send-Telegram -Title $Title -Message $Message) { $sent = $true }

if (-not $sent) {
  Write-Host "[INFO] Keine Phone-Push konfiguriert. Setze z.B. `$env:NTFY_TOPIC='mein-topic'" -ForegroundColor Yellow
  Write-Host "  Android: ntfy App installieren, Topic abonnieren, dann Umgebungsvariable setzen" -ForegroundColor Gray
  Write-Host "  Siehe notification\config.env.example und notification\README.md" -ForegroundColor Gray
  exit 0
}
exit 0

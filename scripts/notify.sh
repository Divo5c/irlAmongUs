#!/usr/bin/env bash
set -e

# Sends a push notification to Divo via ntfy (topic subscribed in the ntfy app).
# Usage: notify.sh "Titel" "Nachricht" [priority 1-5]
TOPIC="${NTFY_TOPIC:-divo-rlaus-7f3k9}"
TITLE="${1:-Real Life Among Us}"
BODY="${2:-Fertig!}"
PRIORITY="${3:-3}"
if command -v powershell.exe >/dev/null 2>&1; then
  # Windows toast (no module needed), best-effort.
  RLAUS_NOTIFY_TITLE="$TITLE" RLAUS_NOTIFY_BODY="$BODY" powershell.exe -NoProfile -Command '
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("ToastText02")
    $texts = $xml.GetElementsByTagName("text")
    $texts.Item(0).InnerText = $env:RLAUS_NOTIFY_TITLE
    $texts.Item(1).InnerText = $env:RLAUS_NOTIFY_BODY
    $toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::new($xml)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("RLAUS").Show($toast)
  ' >/dev/null 2>&1 || true
fi
status=$(curl --fail --silent --show-error --max-time 15 --write-out '%{http_code}' \
  -H "Title: $TITLE" \
  -H "Priority: $PRIORITY" \
  -H "Tags: video_game" \
  --data-raw "$BODY" "https://ntfy.sh/$TOPIC" --output /dev/null)
if [[ $status != 2?? ]]; then
  printf 'ntfy failed with HTTP %s\n' "$status" >&2
  exit 1
fi
printf 'ntfy accepted the notification (HTTP %s).\n' "$status"

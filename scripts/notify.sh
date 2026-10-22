#!/usr/bin/env bash
# Sends a push notification to Divo via ntfy (topic subscribed in the ntfy app).
# Usage: notify.sh "Titel" "Nachricht" [priority 1-5]
TOPIC="${NTFY_TOPIC:-divo-rlaus-7f3k9}"
TITLE="${1:-Real Life Among Us}"
BODY="${2:-Fertig!}"
PRIORITY="${3:-3}"
if command -v powershell.exe >/dev/null 2>&1; then
  # Windows toast (no module needed), best-effort.
  powershell.exe -NoProfile -Command "
    \$xml = New-Object Windows.UI.Notifications.ToastText01
    \$xml.Texts.Append('$TITLE: $BODY') | Out-Null
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('RLAUS').Show(
      [Windows.UI.Notifications.ToastNotification]::new(\$xml))" 2>/dev/null
fi
curl -s -m 10 \
  -H "Title: $TITLE" \
  -H "Priority: $PRIORITY" \
  -H "Tags: video_game" \
  -d "$BODY" "ntfy.sh/$TOPIC" -o /dev/null
echo "notified: $BODY"

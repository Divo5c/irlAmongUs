# Notification — Muse Spark fertig

Zwei Wege, kein Hardcoding von Secrets.

## 1. Desktop (Windows)

`notification/desktop.ps1` zeigt eine native Windows-Toast.

Reihenfolge:
1. **BurntToast** (falls installiert: `Install-Module BurntToast`)
2. `System.Windows.Forms` BalloonTip
3. `WScript.Shell` Popup
4. Konsolen-Fallback

Test:
```powershell
.\notification\desktop.ps1 -Title "Test" -Message "Hallo Desktop"
```

Keine Einrichtung nötig. BurntToast optional für schönere Toasts:
```powershell
Install-Module BurntToast -Scope CurrentUser
```

## 2. Handy (Push)

`notification/phone.ps1` — austauschbar, kein Server nötig. Standard: **ntfy.sh**.

### ntfy.sh (empfohlen)

- Android: **ntfy** App installieren (Play Store / F-Droid)
- In der App: Topic abonnieren, z. B. `my-spark-abc123xyz`
- Windows: Umgebungsvariable setzen (einmalig):

```powershell
# PowerShell $PROFILE (CurrentUserCurrentHost) oder System-Umgebung:
$env:NTFY_TOPIC="my-spark-abc123xyz"
# optional: eigener Server
$env:NTFY_SERVER="https://ntfy.sh"
# optional: Auth
$env:NTFY_USER="user"
$env:NTFY_PASS="pass"
# persistent speichern:
[Environment]::SetEnvironmentVariable("NTFY_TOPIC", "my-spark-abc123xyz", "User")
```

Alternativ `notification/config.env` anlegen:
```
NTFY_TOPIC=my-spark-abc123xyz
NTFY_SERVER=https://ntfy.sh
```

Dann testen:
```powershell
.\notification\phone.ps1 -Title "Test" -Message "Hallo Handy"
```

### Alternativen (falls ntfy nicht gewünscht)

Setze **eine** der folgenden Env-Kombinationen, `phone.ps1` erkennt automatisch:

- **Webhook:** `WEBHOOK_URL=https://example.com/hook` (POST JSON `{title,message}`)
- **Pushover:** `PUSHOVER_TOKEN=...` + `PUSHOVER_USER=...`
- **Telegram:** `TELEGRAM_BOT_TOKEN=...` + `TELEGRAM_CHAT_ID=...`

Es wird versucht: ntfy → Webhook → Pushover → Telegram. Mindestens einer muss konfiguriert sein, sonst nur Info-Meldung.

## 3. Kombiniert

`notification/notify.ps1` ruft beide auf:

```powershell
.\notification\notify.ps1 -Title "Muse Spark fertig" -Message "APK Build done"
```

Wird automatisch von `scripts/build_install.ps1` und vom opencode-Plugin verwendet.

## Einmalige Einrichtung (empfohlen)

1. ntfy Topic wählen und in App abonnieren
2. `notification/config.env.example` nach `notification/config.env` kopieren und Topic eintragen (optional, Env-Var hat Vorrang)
   ODER Env-Var persistent setzen wie oben
3. Desktop: optional `Install-Module BurntToast`

## Keine Secrets im Repo

- Niemals Tokens/Passwörter committen
- `notification/config.env` ist in `.gitignore` (lokal)
- Nur `config.env.example` ist versioniert
- Env-Variablen haben Vorrang

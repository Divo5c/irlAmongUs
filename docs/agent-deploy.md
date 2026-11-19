# Agent-Deploy-Checkliste: Render + ntfy

Nach jeder Änderung an der Browser-PWA diesen Ablauf vollständig ausführen. So steht auf Render dieselbe Version zum Testen bereit, die lokal geprüft wurde.

---

## 1. Vorbereitung (vor jedem Deploy)

| Schritt | Befehl / Aktion |
|---------|-----------------|
| Syntax prüfen | `node --input-type=module --check < server/public/js/app.js` (Bash). Unter PowerShell: `Get-Content -Raw -Encoding utf8 server/public/js/app.js \| node --input-type=module --check`. Analog für geänderte Browser-Module. |
| Tests laufen lassen | `cd server && npm test` |
| Git commit | `git add -A && git commit -m "v19.x.x: Beschreibung"` |
| Git push | `git push origin main` |

Render baut automatisch aus dem GitHub-Repo (Blueprint `render.yaml` ist verbunden). Der Build dauert ca. 1–2 Minuten.

---

## 2. Deploy verifizieren (nach dem Push)

Warte ca. 60–90 Sekunden, dann prüfen:

```bash
# 1. Health-Endpoint
curl -s https://real-life-among-us-beta.onrender.com/health
# Erwartet: {"status":"ok"}

# 2. Neueste Client-Version im HTML
curl -s https://real-life-among-us-beta.onrender.com/ | grep -o '?v=[0-9.]*'
# Muss die gerade gepushte Version sein (z.B. ?v=19.16.3)

# 3. Service-Worker-Cache
curl -s https://real-life-among-us-beta.onrender.com/sw.js | grep CACHE
# Muss die neueste sw-Version sein (z.B. rlaus-shell-v72)
```

Wenn alle drei Checks grün sind: **Deploy ist live.**

> **Wichtig:** Render Free-Plan spinnt Räume/Sessions beim Restart neu. Nach dem Deploy sind alle laufenden Runden weg — das ist normal, kein Bug.

---

## 3. ntfy-Benachrichtigung absetzen

Nach erfolgreichem Deploy:

```bash
bash scripts/notify.sh "RLAUS v19.x.x — Titel" "Kurze Beschreibung des Deploy" [1-5]
```

Beispiele:

```bash
bash scripts/notify.sh "Deploy live" "v19.16.3: Map-Pfeile korrigiert, 72 Tests grün." 4
bash scripts/notify.sh "Build fehlgeschlagen" "npm test rot, siehe Logs." 5
bash scripts/notify.sh "APK fertig" "APK installiert auf Divos Handy." 3
```

**Priorität**: 1 = leise … 5 = Alarm. Default = 3.

### Was das Script tut
- Sendet einen **Windows-Toast** auf Divos PC (best-effort, falls PowerShell verfügbar).
- Sendet eine **Push-Nachricht** via `https://ntfy.sh/divo-rlaus-7f3k9` an Divos Handy (ntfy-App abonniert, Instant delivery AN).

### Thema / Topic
- Topic: `divo-rlaus-7f3k9` (kann per `NTFY_TOPIC=xyz` überschrieben werden).
- Öffentliches Topic — **keine sensiblen Daten** (Passwörter, Tokens, Spielstände) hineinschreiben.

---

## 4. Konventionen (wichtig)

- **Version bump**: `?v=` in `server/public/index.html` nur bei **Client-Änderungen** hochzählen (JS/CSS/HTML). Bei reinen Server-Änderungen nicht bumpen (wie v19.13.6 oder v19.14.2).
- **Service-Worker**: `rlaus-shell-vXX` in `server/public/sw.js` bei jedem Deploy hochzählen (Cache-Invalidierung).
- **Tests**: Pass- und Fehlerzahl aus der Testzusammenfassung prüfen. Für die Fehlersuche einzelne Testdateien ausführen.
- **Ntfy nur bei Fertigmeldungen**: Nicht bei Zwischenständen oder laufenden Edits spammen.
- **Windows**: In PowerShell bei Bedarf Git Bash über `& "C:/Program Files/Git/bin/bash.exe" scripts/notify.sh ...` starten.

---

## 5. Troubleshooting

| Problem | Ursache / Fix |
|---------|---------------|
| Deploy nicht live nach 90s | Render Free spinnt nach 15 Min Inaktivität neu — einfach nochmal warten / neu pushen. |
| `?v=` zeigt alte Version | `?v=` wurde nicht hochgebumpt oder Git-Push nicht durchgelaufen. |
| ntfy kommt nicht an | Android: ntfy-App Benachrichtigungen AN, Instant delivery AN, Batterieoptimierung AUS. |
| Testlauf bleibt nach den Assertions offen | Mit `npm test` laufen lassen und den abschließenden Testbericht prüfen. |

---

## 6. Kurzbefehl (alles auf einmal)

```bash
# Nach Code-Änderungen:
node --input-type=module --check < server/public/js/app.js
cd server && npm test
cd ..
git add -A && git commit -m "v19.x.x: Kurzbeschreibung" && git push origin main
# ~90s warten, dann:
curl -s https://real-life-among-us-beta.onrender.com/health
curl -fsS https://real-life-among-us-beta.onrender.com/ | grep -o '?v=[0-9.]*' | sort -u
curl -fsS https://real-life-among-us-beta.onrender.com/sw.js | grep '^const CACHE'
# Erst nach Abgleich aller drei Ergebnisse:
bash scripts/notify.sh "RLAUS v19.x.x — Deploy" "Kurzbeschreibung" 4
```

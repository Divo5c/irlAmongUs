# KI-/Agenten-Benachrichtigungen (ntfy Push) — Anleitung

Damit jede zukünftige OpenCode-Session zuverlässig Push-Nachrichten an Divos
Handy schicken kann (z.B. sobald ein Build, Test-Run oder Deploy fertig ist),
gibt es ein vorkonfiguriertes Helfer-Script in diesem Repo.

## Was ist das?

`scripts/notify.sh` schreibt:
1. eine **Windows-Toast-Benachrichtigung** auf Divos PC (best effort), und
2. eine **Push-Nachricht** aufs Handy via [ntfy.sh](https://ntfy.sh).

Das Handy-Abo heißt: `divo-rlaus-7f3k9` (in Divos ntfy-App abonniert,
Instant delivery + Notification-Berechtigung sind aktiviert).

## Nutzung (in jeder Session, sofortversationsbereit)

```bash
bash scripts/notify.sh "Titel" "Nachricht" [1-5]
# Beispiel:
bash scripts/notify.sh "Deploy live" "Design + Tap-Fix sind online!" 4
```

- Priorität ist optional (1=leise … 5=Alarm; Default 3).
- Das Topic lässt sich per Env überschreiben: `NTFY_TOPIC=xyz bash scripts/notify.sh ...`
- Wenn das Script fehlt (frischer Checkout), es einfach aus dieser Datei neu anlegen.

## Wann benachrichtigen? (Konvention)

- **Deploy fertig & live verifiziert** (curl hat 200 geliefert)
- **APK komplett gebaut und installiert**
- **Lange Test-/Builddurchläufe fertig** (npm test / flutter test / gradle)
- **Blocker entdeckt**, der Divos Input braucht und länger als ~5 Minuten wartet

Sonstige Aktivitäten (Zwischenstände, laufende Edits) spammen nicht — nur
Fertigmeldungen und Fragen, die Divo echt blockieren.

## Setup-Details (falls neu eingerichtet werden muss)

1. Handy: ntfy-App (Play Store) installieren → „+ Abo" → Topic `divo-rlaus-7f3k9`
   (Server `https://ntfy.sh`).
2. In Abo-Einstellungen: „Instant delivery" AN, Batterieoptimierung aus,
   Android-Berechtigung „Benachrichtigungen" AN.
3. Senden funktioniert ohne Auth mit einem POST auf `https://ntfy.sh/<topic>`
   (Body = Nachricht, Header `Title:` für Titel, `Priority:`, `Tags:`).
   Öffentliches Topic — kein sensibler Inhalt senden.
4. Verifikation: `curl -s "https://ntfy.sh/<topic>/json?poll=1"` zeigt die
   zuletzt gesendeten Nachrichten (12h Retention am Server).

## Probleme & Fixes (aus der Praxis)

- „Nichts angekommen": meist Android Notification-Berechtigung für die ntfy-App
  (Einstellungen → Apps → ntfy → Benachrichtigungen) oder Instant delivery aus.
- PWA zeigt alte Version nach Deploy: seit dem network-first Service-Worker +
  `?v=N`-Query-Params + no-cache Header für JS/CSS sollte das nicht mehr
  passieren; Pro-Deploy `?v=N` in `server/public/index.html` hochzählen.

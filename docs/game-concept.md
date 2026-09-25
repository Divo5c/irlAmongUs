# Real Life Among Us – Spielkonzept

## Projektziel

- Ein soziales Echtzeitspiel für Gruppen im realen Umfeld.

## Spielidee

- Details werden im Rahmen der MVP-Planung definiert.

## Zielplattformen

- Android
- iOS

## MVP-Funktionen (Stand Runde 3 – implementiert)

- Erstellen und Beitreten zu einer Lobby (6-stelliger Code, MAX 10 Spieler)
- Host-Promotion bei Lobby-Abgang, Disconnect-Cleanup
- Server-autoritative GameConfig (Impostors, Tasks, Cooldowns, Phasen-Dauern, Confirm-Ejects, Anonymous Voting)
- Grundlegender Spielablauf: Rollen (geheim, mehrere Impostors möglich), Tasks, Kill mit Cooldown, Report → Diskussion → Voting → Ejection
- Siegbedingungen: Tasks fertig / alle Impostors raus / Impostor-Parität
- **Map-Creator (Android-first):** Host zeichnet die reale Umgebung als 2D-Karte
  (Gänge + Räume + Spielrollen), serverautoritativ, an alle verteilt
- Rematch: Zurück in die Lobby bzw. MAP_READY nach Game Over (nur Host)
- Sessions: Tokens, Rejoin mit Takeover, Rollen-Wiederherstellung

## Gemeinsame Spielmodelle

- **Room**: Code, Host, Spieler, Status (`LOBBY`, `IN_GAME`, `MEETING`,
  `GAME_OVER`), Config, Tasks/Progress, Meeting-Aggregate.
- **Player**: ID, Name, geheime Rolle, Alive/Host-Flags.
- **Task**: Typ aus Katalog + Instanz pro Crewmate.
- **GameConfig**: siehe `shared/models/game-config.schema.json`.

Details zu allen Regeln: `shared/game-rules.md`.

## Gemeinsame Spielmodelle

- Ein **Room** repräsentiert eine Spiel-Lobby mit einem sechsstelligen Code, dem Host, den teilnehmenden Spielern und dem aktuellen Status.
- Ein **Player** besitzt mindestens eine stabile ID, einen Anzeigenamen und eine Rolle. Zusätzliche Daten halten unter anderem Host- und Lebensstatus sowie den Beitrittszeitpunkt fest.
- Vorgesehene **RoomStatus** sind `LOBBY`, `IN_GAME` und `ENDED`.
- Vorgesehene **PlayerRole** sind `CREWMATE` und `IMPOSTOR`; weitere Spezialrollen werden später ergänzt.

## Langfristige Features

- Accounts und Cloud-Synchronisierung
- Zusätzliche Rollen, Spielmodi, Karten und Aufgaben
- Voice-Chat, Matchmaking, Moderation, Freunde und Statistiken
- Lokalisierung, Offline-Modus und Push-Benachrichtigungen

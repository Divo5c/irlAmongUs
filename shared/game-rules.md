# Real Life Among Us – Game Rules (technische Referenz)

Stand: Runde 3 (2026-08-25). Diese Datei ist die verbindliche Beschreibung der
serverautoritativen Spielregeln. Der Server (`server/src/rooms/roomStore.js`
plus `server/src/game/*`) implementiert genau diese Regeln; Clients stellen
sie nur dar.

## 1. Spieler & Räume

- 2–10 Spieler pro Raum (`MAX_PLAYERS = 10`). Empfohlen: ≥ 5, damit die
  Impostor-Paritätsregel nicht sofort greift.
- Joinen ist nur im Status `LOBBY` möglich.
- Ein Raum hat einen 6-Zeichen-Code (Alphabet ohne 0/1) und genau einen Host.
- Verlässt der Host die Lobby, wird das am längsten anwesende Mitglied zum
  neuen Host befördert. Ist niemand mehr übrig, wird der Raum gelöscht.
- Während eines laufenden Spiels bleiben Disconnects dauerhaft im Spiel
  (keine Entfernung), damit Siegbedingungen stabil bleiben.

## 2. Rollen

- Rollen werden bei `game:start` zufällig verteilt: `impostorCount` Impostors,
  alle anderen Crewmates. Genau die konfigurierte Anzahl.
- **Geheimhaltung:** Rollen verlassen den Server niemals in öffentlichen
  Broadcasts. Jeder Spieler erhält seine Rolle ausschließlich privat
  (`game:role_assigned`). Bei Game Over werden alle Rollen aufgedeckt.
- **Impostor-Kennenlernen:** Impostors erhalten in ihrem privaten
  Rollen-Payload das Feld `teammates` (ID + Name der anderen Impostors).
  Crewmates erhalten immer ein leeres `teammates`.

### Gültige Impostor-Anzahl

`1 <= impostorCount <= floor((playerCount - 1) / 2)`

Damit sind Crewmates zu Beginn immer in der Überzahl (sonst würde die
Paritäts-Siegbedingung sofort auslösen). Beispiele:

| Spieler | max. Impostors |
|---|---|
| 4 | 1 |
| 6 | 2 |
| 8 | 3 |
| 10 | 4 |

Wird gegen diese Grenze verstoßen (Konfig oder Spielerzahl geändert),
wirft der Server `CONFIG_INVALID_IMPOSTORS` bei `game:start`.

## 3. Konfiguration (GameConfig)

Nur der Host darf sie ändern, nur im Status `LOBBY` (`CONFIG_LOCKED` sonst).
Alle Werte serverseitig validiert; öffentlicher Teil jeder Room-Projektion.

| Feld | Range | Default | Bedeutung |
|---|---|---|---|
| impostorCount | 1–5 (+Spielerregel) | 1 | Anzahl Impostors |
| tasksPerCrewmate | 1–8 | 2 | Tasks pro Crewmate |
| killCooldownMs | 0–180000 | 20000 | Pause zwischen Kills (0 = aus) |
| discussionDurationMs | 0–180000 | 15000 | Diskussionsphase vor dem Voting (0 = überspringen) |
| votingDurationMs | 5000–300000 | 30000 | Maximale Votingdauer |
| confirmEjects | bool | true | Ejection nennt den Namen |
| anonymousVoting | bool | false | Tally am Meetingende verbergen |

## 4. Aufgaben (Tasks)

- Katalog mit festen Typen (fix_wiring, swipe_card, upload_data, …).
- Instanz: `{id: <type>-<playerNr>-<taskNr>, type, assignedTo, title,
  completed, completedAt}`.
- Nur der zugewiesene (lebende) Spieler kann abschließen; kein Doppelabschluss;
  Fortschritt ist serverautoriativ (`taskProgress {completed,total}`).
- Crew-Sieg, sobald **alle** Tasks abgeschlossen sind.

## 5. Kill

- Nur lebende Impostors, nur Status `IN_GAME`, Ziel muss leben und darf nicht
  man selbst sein.
- Cooldown pro Raum (`killCooldownMs`); Verstoß → `KILL_ON_COOLDOWN` mit
  `retryAfterMs`.
- Das Opfer wird öffentlich sichtbar tot (`isAlive=false`, Broadcast
  `game:killed` mit Opfer-ID). Der Täter wird nicht genannt.
- Clients sehen `killReadyAt` (Epoch-ms) in öffentlichen Updates; der Button
  ist reine UX – der Server entscheidet weiterhin.

## 6. Meetings: Report → DISCUSSION → VOTING → RESULT → Spiel

1. **Report:** Ein lebender Spieler meldet → Status `MEETING`, Phase
   `DISCUSSION`. Kein Voting während der Diskussion (`VOTING_NOT_OPEN`).
2. **DISCUSSION:** Läuft `discussionDurationMs`; Countdown für alle; danach
   schaltet der Server automatisch auf `VOTING` (Event `game:voting_started`).
3. **VOTING:** Jeder Lebende hat genau eine Stimme (Ziel muss leben oder
   Skip). Tote können weder voten noch gemeldet bekommen werden sie gezählt.
   Endet automatisch bei Deadline **oder** sobald alle Lebenden gevotet haben.
4. **RESULT:** Streng Meistgewählter wird ausgeworfen; Unentschieden oder
   Skip-Mehrheit → niemand fliegt. Mit `confirmEjects` wird der Name genannt,
   mit `anonymousVoting` entfällt die Tally. Danach zurück zu `IN_GAME`
   oder direkt `GAME_OVER` bei Siegbedingung.

Während des gesamten Meetings sind Kills und Task-Completions blockiert
(`NOT_IN_GAME`).

## 7. Siegbedingungen (geprüft nach jedem Task/Kill/Meeting)

1. Alle Tasks fertig → **CREWMATE**
2. Kein Impostor mehr am Leben → **CREWMATE**
3. `aliveImpostors >= aliveCrewmates` → **IMPOSTOR**

Bei Sieg: Status `GAME_OVER`, Event `game:over` mit Gewinner + allen Rollen.

## 8. Rematch

Nur der Host, nur ab `GAME_OVER` (`game:reset`). Zurück nach `LOBBY`:
Code, Host, Spielerreihenfolge, Session-Tokens und Config bleiben erhalten;
Rollen, Alive-State, Tasks, Ejections, Votes und Cooldowns werden vollständig
verworfen. Anschließend startet der Host eine frische Runde.

## 9. Sessions & Reconnect

- Bei Create/Join stellt der Server privat ein Session-Token aus
  (`session:created`).
- `room:rejoin {code, playerId, token}` bindet einen neuen Socket an die
  Identität (Takeover kickt den Alt-Socket) und stellt öffentlichen Zustand +
  privat Rolle/Tasks wieder her (solange das Spiel läuft).
- Zwei Sockets mit derselben Identität sind dadurch ausgeschlossen.

## 10. Datenklassifizierung

| Klasse | Beispiele | Wo |
|---|---|---|
| Öffentlich | identities, isAlive, config, taskProgress, meetingPhase/-deadlines, votedCount, killReadyAt, winner, ejectedPlayerIds | Broadcasts + REST |
| Privat (pro Spieler) | eigene Rolle, eigene Tasks, Teammates, Session-Token | nur an den besitzenden Socket |
| Serverintern | Rollen aller, Einzelstimmen, lastKillAt, Tokens-Map | nie außerhalb |

## 11. Karte & Map-Setup

Vor dem ersten Spiel startet der Host das **Map-Setup** (Status
`MAP_SETUP`): Er läuft durch die reale Umgebung und zeichnet Gänge als
Knoten/Kanten sowie Räume als Polygone; jeder Raum erhält eine Spielrolle
(`RoomType`). `map:save` validiert die Karte (mind. ein Korridor über zwei
Knoten), erhöht die `version` und setzt den Raum auf `MAP_READY`. Erst dann
ist `game:start` möglich. Details: `docs/map-system.md`.

## 13. Physische Nähe / Zonen (geplant)

Kill und Report sind bewusst so implementiert, dass an einer einzigen Stelle
(`RoomStore.killPlayer` bzw. `reportBody`, markiert als PROXIMITY HOOK) später
eine serverseitig verifizierte Zone-/Näheprüfung eingeschoben werden kann,
ohne Clients oder Events zu ändern. Die Karte aus dem Map-System liefert dafür
Räume und Korridorgraph.

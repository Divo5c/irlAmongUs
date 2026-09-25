# OPENCODE-ABSCHLUSSBERICHT (Real Life Among Us – Kernfunktionen)

Stand: Runde 4 (2026-08-26) · Server-Tests: **61/61** · Flutter analyze: **0 issues** · Flutter test: **13/13** · E2E (4 Spieler, echte Sockets): **bestanden**

---

# Runde 4 – Flutter-Verifikation & End-to-End-Nachweis

## Flutter erstmals wirklich ausgeführt
Flutter 3.47.1 / Dart 3.13.1 (stable, offizielles Release-Archiv) in WSL installiert.
Wichtig für die Umgebung: `flutter test` muss im **Linux-Dateisystem** laufen
(Projektspiegel `~/rlau`), da impellerc auf `/mnt/d` (DrvFs) an File-Attributen
scheitert. `flutter analyze` funktioniert direkt im Repo.

## Ergebnisse
| Prüfung | Ergebnis |
|---|---|
| `flutter pub get` | ok |
| `flutter analyze` | **No issues found!** |
| `flutter test` | **13/13 bestanden** |
| `npm test` (Server, unverändert) | **61/61 bestanden** |

## Behobene Bugs
| P | Datei | Bug |
|---|---|---|
| P0 | app/test/widget_test.dart | fehlender Import → `GameSettingsPanel` unbekannt (Compile-Fehler in Tests) |
| P1 | app/lib/core/network/socket_client.dart | Vote-Payload: null-aware-Syntax korrigiert (`'targetId': ?targetId`) |
| P1 | app/tool/e2e_game_flow.dart | Start-Race im Test-Harness (Join vor Create; Host-Emit erst nach Await); Opfer-Koordination via Hint-Dateien; Hybrid-Waits (Stream+REST) gegen verpasste Einmal-Broadcasts |
| P3 | meeting_view.dart / socket_client.dart | unused variable, avoid_print-Anpassung |

## End-to-End-Nachweis (neu)
`app/tool/e2e_game_flow.dart`: ein Prozess pro Spieler (realistisch: 1 Gerät = 1
Verbindung). Vier Prozesse spielten ein KOMPLETTES Match gegen den echten Server:
Create/Join×3 → Host-Config → Start → private Rollen (+leere Teammates für Crew,
Typisierte Tasks) → Task-Fortschritt → Kill (Opfer öffentlich) → Report →
DISCUSSION (Votes blockiert) → automatisches VOTING → Skip-Mehrheit → RESULT →
zurück IN_GAME → weitere Kills bis Parität → GAME_OVER mit Rollen-Reveal →
Host-Rematch → LOBBY mit gewaschenem State → frische Runde.
Ergebnis: host 24 / p2 18 / p3 17 / p4 17 Checks OK, Exit 0.

Bekannte Umgebungseinschränkung (nicht spielrelevant): mehrere parallele
Socket.IO-Verbindungen innerhalb EINES Dart-Prozesses werden vom Paket
socket_io_client zuverlässig erst nach der ersten verbunden — deshalb ein Prozess
pro Spieler. In der App existiert immer genau eine Verbindung pro Gerät.

---

# Runde 3 – MVP+ : Rematch, Config, Multi-Impostor, Phasen

## Neue Features (alle serverautoritativ + getestet)
1. **Rematch** (`game:reset`, host-only, nur GAME_OVER): `resetToLobby()` verwirft Rollen/Alive/Tasks/Ejections/Votes/Cooldown, behält Code/Host/Spieler/Reihenfolge/Tokens/Config. Clients zeigen danach automatisch die Waiting-Lobby im GameScreen; Host startet neu.
2. **GameConfig** (`game:update_config`, host-only, LOBBY-only): impostorCount(1–5), tasksPerCrewmate(1–8), killCooldownMs(0–180k), discussionDurationMs(0–180k), votingDurationMs(5k–300k), confirmEjects, anonymousVoting. Strikte Sanitizing-Fehler `CONFIG_INVALID{field}`, Spielerzahl-Regel `CONFIG_INVALID_IMPOSTORS` (= floor((n−1)/2)), Sperre im Spiel `CONFIG_LOCKED`. Config ist öffentlicher Teil jeder Projektion.
3. **Mehrere Impostors:** exakte Verteilung per Partial-Fisher-Yates; private `teammates` (ID+Name) nur für Impostors; Siegbedingungen parity/elimination funktionieren generisch.
4. **Meeting-Phasen:** REPORT → DISCUSSION (keine Votes, `VOTING_NOT_OPEN`) → VOTING (Deadline oder Quorum) → RESULT → Spiel. Timer-Kette im Socket-Layer über gespeicherte Deadlines (`armNextMeetingTimer` + `advanceMeeting`), robust gegen doppelte/stale Fires. Neues Event `game:voting_started`.
5. **Task-Katalog** (`server/src/game/taskCatalog.js`): 10 Typen mit stabilen Instanz-IDs `<type>-<playerNr>-<taskNr>`; `type` fließt in Payloads + Schema.
6. **Cooldown-UX:** `killReadyAt` (Epoch-ms) in öffentlichen IN_GAME-Projektionen + privates `game:kill_cooldown` nach Kills; Kill-Button zeigt Restzeit und ist reine UX (Server validiert weiter).
7. **Confirm-Ejects / Anonymous-Voting** wirken real auf das Result-Payload (Name bzw. Tally).

## Architektur
- Extraktion der reinen Spielregeln aus dem Store: `server/src/game/errors.js` (GameError), `config.js` (Defaults/Bounds/sanitize/maxImpostorsFor), `taskCatalog.js`, `victory.js`. RoomStore bleibt zentrale State-Maschine (~740 Zeilen), Status-Aliase (STATUS_LOBBY…) ersetzen Magic Indices.
- `RoomStore({config})` als Basis-Defaults statt Constructor-Dauer-Optionen; Meeting-Timer lesen `room.config`.

## Events (neu/geändert)
| Event | Änderung |
|---|---|
| `game:update_config` C→S | neu (host-only) |
| `game:reset` / `game:reset_done` | neu (host-only) |
| `game:voting_started` S→C | neu |
| `game:kill_cooldown` S→C | neu (privat an Impostors) |
| `game:meeting_started` | + phase, discussionDeadline |
| `game:meeting_result` | ± tally (anonymous), ejectedPlayerName (confirmEjects) |
| `room:updated` | + config, meetingPhase, deadlines, votedCount, killReadyAt |

## Flutter
SocketClient (+`votingStartedUpdates`, `updateConfig`, `requestReset`, `clearRoundCaches`) · GameScreen: LOBBY-Zweig (Waiting Lobby mit Code/Spielern/editierbaren Settings/Start), Kill-Button mit Cooldown-Restzeit, MeetingView phasengesteuert, Cache-Clear bei Rematch · GameOverView: Host-Rematch vs. Waiting-Hint · GameSettingsPanel (neu, geteilt) in HostLobby + JoinRoom (read-only). Widget-Tests erweitert (Discussion/Voting-Wechsel, Cooldown-Disable, Rematch host/non-host, Lobby-Reset, Config-Patches).

## Tests
61 gesamt: RoomStore 42 (Config-Bounds/Lock/Impostor-Grenzen, Multi-Impostor+Teammates, Task-Katalog/Typen, Phasen, Ejection/Tie/Skip/Anonym, Rematch-Isolation inkl. Leak-Check, Victory-Matrix, Tokens) + Integration 19 (Phasen über Draht, Voting-Quorum, Timer-Kette, Reset→Neustart, Config-Rechte, Cooldown-Privatheit, Secrecy-Rejoin).

---

# Runde 2 – Robustheit, Sessions & Cooldowns (2026-08-25)

## Neue Server-Funktionen
1. **Lobby-Membership:** `removePlayer()` entfernt Spieler nur im Status LOBBY; Host-Abgang promoted das am längsten anwesende Mitglied; verlässt der letzte Spieler den Raum, wird der Raum samt Tokens gelöscht. Im laufenden Spiel bleiben Spieler persistiert (stabile Siegbedingungen).
2. **Session-Tokens:** Server generiert pro Spieler ein UUID-Token (`issueToken`), ausgeliefert ausschließlich über das private Event `session:created`. Tokens werden nie in öffentlichen Broadcasts/REST geschickt.
3. **Rejoin:** Neues Event `room:rejoin {code, playerId, token}` stellt nach App-Refresh/Abbruch die Bindung wieder her: Takeover kickt den Alt-Socket, Client erhält `room:rejoined` + aktuellen öffentlichen Room + **privat erneut** `game:role_assigned` (nur bei IN_GAME/MEETING). Falsches Token → `room:error AUTH_FAILED`.
4. **Disconnect-Handling:** `primarySockets`-Registry verhindert, dass ein überholter Alt-Socket den neuen Besitzer der Identität aus der Lobby wirft; leere Räume räumen Meeting-Timer auf.
5. **Kill-Cooldown:** Konfigurierbar (`RoomStore({killCooldownMs})`, Default 20 s, `0` = deaktiviert); Verstoß → `KILL_ON_COOLDOWN` mit `details.retryAfterMs`.
6. **MAX_PLAYERS = 10** (`ROOM_FULL`); toter Code `updateRoomStatus()` entfernt; `RoomStoreError` trägt optionale `details`.

## Neue Socket-Events
| Event | Richtung | Zweck |
|---|---|---|
| `session:created` | S→C (privat) | `{code, playerId, token}` einmalig nach create/join |
| `room:rejoin` | C→S | Wiedereinstieg mit Token; validiert + Takeover |
| `room:rejoined` | S→C | `{...öffentlicher Room, playerId}` Bestätigung |

## Flutter
`SocketClient` speichert Session-Credentials und sendet bei jedem Reconnect automatisch `room:rejoin`; `room:rejoined` fließt in den normalen `roomUpdates`-Stream → Screens aktualisieren sich ohne UI-Änderungen. Kill-Cooldown-/Auth-Fehler erscheinen über den bestehenden errors-Stream als SnackBar.

## Tests Runde 2 (+21 → 68 gesamt)
Lobby-Membership (6), Tokens (3), Kill-Cooldown (4), Integration: Disconnect/Promotion/Persistenz (3), Session/Rejoin inkl. Secrecy & Takeover & Bad-Token (5).

## Bekannte Punkte (Runde 2)
- Token = Bearer-Geheimnis im Speicher; Verlust des Geräts = Identitätsverlust (echte Auth kommt mit Accounts).
- Kein Persistenz-Layer: Serverneustart invalidiert alle Sessions weiterhin.
- Cooldown ist serverglobal pro Raum (nicht pro Impostor relevant, da 1 Impostor).

---

## 1. Durchgeführte Änderungen

### Server
| Datei | Änderung |
|---|---|
| `server/src/rooms/roomStore.js` | Neu geschrieben: `toPublicRoom()` (Rollen/Tasks werden entfernt, nur `taskProgress`), `startGame()` liefert jetzt `{assignments, tasksByPlayer, room}` statt des vollen Rooms, neue Methoden `getTasksForPlayer`, `completeTask`, `reportBody`, `killPlayer`, `endGame`, `checkWinConditions`; Join nur noch im Status LOBBY; Tasks (2 pro Crewmate) werden beim Start generiert; `isAlive` wird bei Join/Start erzwungen. |
| `server/src/socket/socketServer.js` | Broadcasts ausschließlich mit öffentlicher Projektion; neues privates Event `game:role_assigned` pro Socket; neue validierte Events `task:complete`, `game:report`, `game:kill`; playerId für Aktionen kommt **nur** aus `socket.data.playerId` (nie aus dem Payload); `assertSocketInRoom`-Guard; `broadcastGameOver` reveal Rollen erst bei GAME_OVER. |
| `server/src/api/roomsController.js` | Alle REST-Antworten über `toPublicRoom()` (Rollen-Leak per HTTP geschlossen). |
| `server/package.json` | `"test": "node --test --test-force-exit"` ergänzt. |
| `server/test-payload.json` | Code `ABC123` → `ABC234` (`1` ist im Code-Alphabet ungültig). |
| `server/test/roomStore.test.js` | NEU: 20 Tests (Sekretion, Tasks, Kill-Validierung, Report, Siegbedingungen). |
| `server/test/socketServer.test.js` | NEU: 8 Integrationstests über echte socket.io-Clients (private Rollen, Nicht-Host-Start, Task-Fortschritt ohne Details, Kill + Game Over, Crew-Kill-Abweisung, Meeting, REST-Sanitizing). |

### Shared
| Datei | Änderung |
|---|---|
| `shared/models/enums.schema.json` | `RoomStatus` erweitert um `MEETING`, `GAME_OVER` (`ENDED` als Legacy erhalten). |
| `shared/models/task.schema.json` | NEU: Task-Schema (`id`, `assignedTo`, `title?`, `completed`, `completedAt?`). |
| `shared/models/room.schema.json` | Optionale Felder `tasks` (privat), `taskProgress {completed,total}` (öffentlich), `winner`. |
| `shared/models/player.schema.json` | Beschreibung von `role`: SECRET, nie in öffentlichen Broadcasts. |

### Flutter-App
| Datei | Änderung |
|---|---|
| `app/lib/core/network/socket_client.dart` | Interface erweitert: Streams `roleAssignments`, `taskProgressUpdates`, `meetingUpdates`, `killUpdates`, `gameOverUpdates`, `errors`; Cache `latestRoleAssignment`/`latestGameOver` (Navigation-Race); Fire-and-forget-Methoden `completeTask`, `reportBody`, `killPlayer`. |
| `app/lib/features/game/presentation/game_screen.dart` | NEU: GameScreen (Rolle, Spielerliste alive/dead, Raumstatus, Task-Liste mit „Done", Fortschritt X/Y, Report-Button, Kill-Button nur Impostor inkl. Ziel-Auswahl-Dialog); rendert je nach Status Game-/Meeting-/GameOver-View. |
| `app/lib/features/game/presentation/meeting_view.dart` | NEU: Meeting-Ansicht (Reporter, Diskussions-Prompt, Voting-Platzhalter-Chips). |
| `app/lib/features/game/presentation/game_over_view.dart` | NEU: Ergebnis (Crew/Impostor gewinnt), Rollen-Reveal, „Back to Home". |
| `app/lib/features/host/presentation/host_lobby_screen.dart` | Nach erfolgreichem `startGame` → `pushReplacement` auf GameScreen (mit `initialRoom`). |
| `app/lib/features/join/presentation/join_room_screen.dart` | Wechselt bei Statuswechsel zu IN_GAME/MEETING automatisch in den GameScreen. |
| `app/lib/shared/widgets/room_lobby_details.dart` | Rollen-Anzeige entfernt (öffentliche Rooms enthalten keine Rollen mehr); Parameter `playerId` entfernt. |
| `app/test/widget_test.dart` | Fake an neues Interface angepasst; 6 Tests: Home, Host-Lobby, Host→GameScreen (private Rolle + Kill-Button), Join-Flow, Crewmate ohne Kill-Button, Task-„Done" sendet `task:complete`. |

## 2. Neue Features
- **Geheime Rollen**: Server sendet öffentliche Rooms ohne Rollen; Rollen + Tasks gehen nur privat per `game:role_assigned` an den jeweiligen Socket. Reveal erst bei GAME_OVER.
- **Game-Screen**: Nach Spielstart landen Host und Joiner automatisch im GameScreen.
- **Task-Basis**: 2 Tasks pro Crewmate (Katalog mit 6 Titeln), „Done"-Button, Server-validiert (nur eigene, offene Tasks, nur lebende Spieler), Fortschritt broadcast.
- **Report & Meeting-Basis**: Report setzt Status MEETING, alle Clients wechseln in die Meeting-Ansicht (Voting-Platzhalter).
- **Kill-Basis**: Nur Impostor sieht/sendet Kill; Server validiert Impostor/IN_GAME/Ziel lebt/nicht Selbst; Opfer wird `isAlive=false`; Todes-Broadcast nennt nur das Opfer, nie den Killer.
- **Siegbedingungen-Basis**: Crew gewinnt bei allen Tasks fertig; Impostor bei #Impostor ≥ #lebendeCrew. Prüfung nach jedem Task/Kill → GAME_OVER + `game:over`.

## 3. Socket.IO-Events

| Event | Richtung | Zweck | Validierung (Server) | Status |
|---|---|---|---|---|
| `room:create` | C→S | Raum erstellen | Code-Regex, eindeutig, hostId nötig | bestand |
| `room:created` | S→C | Öffentlicher Room an Host | – | angepasst (sanitized) |
| `room:join` | C→S | Lobby beitreten | Room existiert, Status=LOBBY, ID eindeutig | angepasst |
| `room:updated` | S→C | Öffentliche Raum-Updates | – | angepasst (ohne Rollen/Tasks) |
| `game:start` | C→S | Spiel starten | nur Host, eigener Raum, LOBBY, ≥2 Spieler | bestand |
| `room:error` | S→C | Fehlercode+Message | – | bestand |
| `game:started` | S→C | Signal „Spiel läuft" (öffentlich) | – | neu |
| `game:role_assigned` | S→C **(privat)** | Eigene Rolle + eigene Tasks | Zustellung nur an Matching-Socket (roomCode+playerId) | neu |
| `task:complete` | C→S | Task abhaken | IN_GAME, Spieler bekannt/lebend, Task gehört dem Sender (playerId aus `socket.data`) | neu |
| `task:progress` | S→C | `{completedTaskId, progress{completed,total}}` – keine Details | – | neu |
| `game:report` | C→S | Körper melden | IN_GAME, Sender bekannt/lebend | neu |
| `game:meeting_started` | S→C | `{reportedBy}` → MEETING | – | neu |
| `game:kill` | C→S | Töten | nur IMPOSTOR, lebend, IN_GAME, Ziel lebt ≠ Selbst | neu |
| `game:killed` | S→C | `{killedPlayerId}` (Täter bleibt verborgen) | – | neu |
| `game:over` | S→C | Gewinner + Rollen-Reveal | – | neu |

REST (`POST /rooms`, `GET /rooms/:code`, `POST /rooms/:code/join`) antwortet ausschließlich mit öffentlichen Projektionen.

## 4. Sicherheitsmaßnahmen
- Rollen verlassen den `RoomStore` nur via `toPublicRoom()` (gestrippt), private Assignment-Zustellung oder `game:over`.
- Aktions-Events nutzen `socket.data.playerId` (beim create/join gesetzt) statt Client-Payload → kein Task-Klauen/Fremd-Killen unter fremder ID.
- Zentrale Validierungen: Status-Maschine (LOBBY→IN_GAME→MEETING/GAME_OVER), Host-Check bei Start, Impostor-/Lebendigkeits-/Ziel-Checks, Join-Sperre nach Spielstart.
- **Weiter offen:** playerIds sind client-generiert und fälschbar (kein Auth/Token); zwei Devices könnten sich vor Spielstart gegenseitig die ID wegnehmen; Reconnect-Identität nicht gebunden; keine Rate-Limits; Zone-Proximity für Kills fehlt (bewusst später); REST erlaubt Raum-Erstellung ohne Socket.

## 5. Bekannte Probleme & technische Schulden
- Flutter-Seite konnte hier **nicht kompiliert/getestet/analyziert** werden (kein SDK in der Umgebung). Dart-Code wurde manuell reviewt; bitte lokal `flutter analyze && flutter test` nachziehen.
- Kein Disconnect-Handling: Räume/Spiele bleiben bestehen; Host-Migration fehlt; tote Verbindungen werden nicht entfernt.
- `updateRoomStatus()` ist weiterhin ungenutzt (Statuswechsel laufen über Fachmethoden).
- Meetings enden aktuell nicht (kein Resume zu IN_GAME, kein Voting) – MEETING ist terminal bis auf Siegbedingungen via Tasks (die im Meeting blockiert sind).
- `--test-force-exit` im Testscript: Engine.IO hält Handles offen; sauberer wäre Handle-Aufräumen.
- print()-Logging im Client und Server (kein strukturiertes Logging).
- Kein State-Management (setState + Streams) – bei mehr Screens empfiehlt sich zentraler GameState.
- Single-Impostor fest verdrahtet; TASKS_PER_CREWMATE=2 konstant.

## 6. Fehlende Funktionen (bewusst verschoben)
- Voting/Meeting-Ende + Rückkehr zu IN_GAME, Sabotage, Kill-Cooldown, Proximity/Zonen
- Mehrere Impostoren/Spezialrollen, Reconnect-Wiederherstellung der Rolle, Spectator-Modus für Tote
- Accounts/Auth, Persistenz, Rate-Limiting, Lokalisierung (UI ist Englisch)

## 7. Nächste Schritte (priorisiert)
1. `flutter analyze && flutter test` lokal ausführen und ggf. kleine Fixes nachziehen.
2. ~~Voting im MeetingScreen + Meeting-Ende~~ ✅ erledigt (Runde 1.1).
3. ~~Disconnect-Handling + Reconnect~~ ✅ Basis erledigt (Runde 2: Tokens, Rejoin, Lobby-Cleanup). Offen: Wiedereinstieg mitten ins Meeting zeigt Countdown korrekt, aber verpasste `meeting_started`-Details (Reporter-Name) kommen aus dem öffentlichen Room; Reconnect-Delay/Backoff der Clients tunen.
4. Kill-Cooldown ✅ (Runde 2); offen: Cooldown-Restzeit an Clients signalisieren (z. B. Feld `killReadyAt`), Zonen-Check (Player-Standort in Room-Modell ergänzen).
5. Auth-fähige Identität (Server-generierte UUID statt client-seitiger IDs + Accounts).
6. Mehrere Impostoren proportional zur Spielerzahl konfigurierbar machen.

## 8. Anleitung zum Testen
```bash
# Server (Port 3000)
cd server && npm install   # node_modules existiert bereits
npm test                   # 28 Tests
npm start                  # Real Life Among Us server listening on port 3000

# App (Android/iOS-Gerät im selben Netz)
cd app
flutter run --dart-define=SERVER_URL=http://<LAN-IP>:3000
# Android-Emulator: http://10.0.2.2:3000 ; iOS-Simulator: http://localhost:3000

flutter analyze && flutter test   # lokal nachziehen (hier nicht ausführbar)
```
Manueller Ablauf (mind. 2 Geräte):
1. **Geheime Rollen/Game-Screen:** Gerät A „Host Game" → Code notieren; Gerät B „Join Game" → Code; A drückt „Start Game" → beide landen im GameScreen, jeder sieht nur die eigene Rolle (Impostor erkennt man am roten Karten-Hintergrund + Kill-Button). Netzwerk-Check: In `room:updated`-Payloads (z. B. DevTools) taucht kein `role` auf.
2. **Tasks:** Als Crewmate bei einem Task „Done" tippen → Fortschritt „X / Y done" aktualisiert bei allen.
3. **Report:** „Report Body" tippen → alle wechseln in die Emergency-Meeting-Ansicht (Voting-Platzhalter).
4. **Kill:** Als Impostor „Kill" → Ziel wählen → Opfer erscheint bei allen grau mit „(dead)".
5. **Siegbedingungen:** Alle Crew-Tasks abhaken → „The Crew wins!" + Rollen-Reveal. Oder 1v1 starten und killen → „The Impostor wins!".

## 9. Zusammenfassung für den technischen Leiter
Der kritische Rollen-Leak ist behoben: Der Node/Socket.IO-Server projiziert jeden Room vor dem Senden (`toPublicRoom` – ohne `role`, ohne Task-Details, dafür `taskProgress`) und stellt Rollen/Tasks ausschließlich privat per `game:role_assigned` an das jeweilige Socket zu; REST antwortet ebenfalls sanitized. Neue Basisfeatures vollständig serverseitig implementiert und mit 28 Node-Tests (Unit + echte Socket-Integration) abgesichert: Task-System (validiertes `task:complete` → aggregierter Fortschritt), Report→MEETING, validiertes Kill-System (Opfer-Only-Broadcast) sowie Siegbedingungen (Crew: alle Tasks; Impostor: Parität) mit `game:over`-Reveal. Flutter-Seite: neuer GameScreen mit rollenabhängiger UI (Kill nur Impostor), Meeting- und GameOver-Views, Navigation aus Host-/Join-Lobby, SocketClient um sechs Event-Streams + Caches erweitert; Widget-Tests (6) aktualisiert. Aktionen nutzen serverseitige `socket.data.playerId` statt Payload-IDs. Offene Punkte: Flutter-Toolchain-Lauf ausstehend, Disconnect/Reconnect, Voting/Meeting-Ende, Auth/IDs, Cooldowns/Zonen.

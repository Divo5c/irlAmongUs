# Implementation Report — Round 11: v19.13.4 + v19.13.5

## Field Reports Fixed

### R1: "Nach einer Runde ist die Map nicht kalibriert" (Divo, 3.11)
Root cause chain, in two layers:

1. **v19.13.4 (already deployed):** the device map cache (`rlaus.savedMap.v1`)
   did not store the calibration at all — `map:save` handler dropped `cal`,
   and every cache-restore path sent map payloads without it. Fixed: the
   save-handler caches `cal: state.room?.map?.cal ?? null`, and both
   `pendingCachedLoad` emits + `applyCachedMap` carry
   `...(cached.cal ? { cal: cached.cal } : {})`. Server-side
   `sanitizeGameMap` keeps a matching `cal` (p1/p2 >= 5 m apart in map AND
   world coordinates), so the room accepts it.
2. **v19.13.5 (this round):** a rematch (`game:reset` → `resetToLobby`) does
   keep `room.map` + cal server-side (`room.status = room.map ? MAP_READY :
   LOBBY`) — that path was never broken. What Divo actually hit was creating
   a **brand-new room** (new code): empty room, no map, manual "load map" click.
   Now the host **auto-loads** the cached map when entering a fresh lobby:
   `renderLobby()` fires `map:start` + sets `state.pendingCachedLoad = true`
   once per room (`state.autoMapReloaded = room.code`), the existing
   MAP_SETUP branch then loads + saves the cached map (cal included) and the
   room lands in `MAP_READY` — start button ready, no Overpass fetch, no
   button press, calibration survives into the new room.

### R2: Kill-Sound + Info-Text für alle (leak, Among Us violation)
Before: human `game:kill` and bot kills broadcast `game:killed` to the whole
room — every crewmate got the kill sound + "Jemand wurde eliminiert" hint
instantly, so the body-discovery loop collapsed.

After (Among Uem: like Among Us):
- `game:killed` is now **private**: victim (they know they are dead) and all
  impostor players only. Crewmates learn about deaths exclusively by finding
  corpses.
- The public `room:updated` right after a kill is **no longer broadcast**
  (it carried `isAlive: false` — an instant death leak).
- Impostor cooldown still syncs privately via `game:kill_cooldown`
  (unchanged, was already private).
- Bot kills (bots.js `tryBotImpostorKill`) mirror the same privacy using the
  engine `broadcast(code, event, payload, playerId)` adapter.
- i18n: new key `game.killLanded` (de "Kill gelandet! …", en "Kill landed!…")
  for the impostor hint; victim keeps `game.youKilled`.

### R3: "Gespeicherte Karte soll Couch sofort geladen sein" — covered by auto-load above (no button press anymore).

### R4: "Einstellungen der letzten Runde übernehmen" (auto-apply)
- Host saves the round's config on every `room:updated` into device
  `localStorage` key `rlaus.lastConfig`.
- On `room:created` (new room as host) the client emits
  `game:update_config` with the stored config; the server clamps/validates
  (same code path as the lobby autosave) and broadcasts `room:updated`,
  which re-renders the rules card with the values. Toasts: none for config
  (silent carry-over), map gets "Gespeicherte Karte wird automatisch geladen…".

## Among Us Audit Snapshot (this round)
- Task victory / ejection / impostor-parity end conditions: already Among-Us-
  correct (verified in the v19.13.2 round, socketServer + victory.js).
- Kills: now victim+impostors only ✓; corpses only reachable via position
  updates (`nearbyBodies`, sender-private) ✓; public room has no corpses ✓.
- Meeting/ejection reveals stay public ✓ (matches Among Us).
- `killReadyAt` is public in `toPublicRoom` — mild leak (crew could in theory
  time kills), no crew UI renders it. Accepted for now.
- Ghost reporting (dead players may report) — deliberate real-life design of
  Divo's concept, kept.

## Test Flake Fixes (bonus, this repo had 2 hidden flakes)
1. `bots.test.js` "auto-complete crew tasks…": an impostor bot could
   insta-kill a crew bot at tick 1 (cooldown never elapsed) → parity with no
   endGame chain in the store → assertion measured the wrong bot. Fixed by
   forcing both bots to `CREWMATE` in that test (impostor behavior has its
   own tests) and crediting ANY crew bot's progress.
2. `roomStore.test.js` "task instances carry stable ids…":
   `assert.match(task.type, /^[a-z_]+$/)` fails for the real catalog type
   `clean_o2_filter` (contains a digit). Regex now `/^[a-z0-9_]+$/`. This
   explains ever-changing 200/199/176 pass-counts across runs.

## New Regression Test
- `kill notifications stay private: victim + impostors only (Among Us)` —
  4-player room over the wire: victim and impostor receive `game:killed`,
  one extra crewmate must receive exactly zero of them within 250 ms.

## Deploy
- `?v=19.13.5`, sw `rlaus-shell-v60`. Full suite: 201 pass / 0 fail
  (`node --test --test-force-exit server/test/*.test.js`).

## v19.13.6 hotfix (same day): "neue Runde → map nicht kalibriert" PERSISTED

Divo re-tested after the v19.13.5 deploy: leave a round, create a brand-new
room → still not calibrated. Missing piece: his device cache was saved by an
OLD app version (before v19.13.4), so `rlaus.savedMap.v1` has **no `cal` at
all** — the auto-load restores nodes faithfully but no calibration. And the
one-time "recalibrate + save" instruction was not executed between deploys.

Server-side solution: the store now keeps a **device-independent memory of
the last VALIDLY SAVED map** (`roomStore.#lastGoodMap`, includes the
calibration):

- `saveMap()` successfully validating + sanitized copies the map into the
  memory — but ONLY when the map carries a `cal` (a cal-less save can never
  wipe the calibrated memory).
- `startMapSetup()` seeds a brand-new empty-room map from that memory
  instead of starting with an empty skeleton. The room arrives in MAP_SETUP
  already calibrated; the client's subsequent map:update/map:save without a
  cal payload keep the seeded `cal` (existing protection in both handlers).

Two independent paths now deliver a calibrated new room:
1. fresh device cache WITH cal (v19.13.4 client path), or
2. server memory seeded by ANY successful calibrated save (any phone, after
   exactly ONE manual calibration on any room).

One-time bootstrapping note for Divo (unchanged): after a Render restart the
server memory is empty — walk out once, click 2 calibration points, save.
After that, EVERY new room on the server stays calibrated even across device
caches gone stale.

New tests (game.map.test.js): fresh room seeds incl. cal; stale editor
snapshot without cal cannot erase the seeded cal; cal-less save does not
wipe the memory. Suite: 202 pass / 0 fail.

- Open follow-up ideas: ROOM_TASKS per-map catalog (Divo's Among-Us-Werk doc),
  optional restyle of the rules card, "bots a bit slow" pacing.

## v19.13.7 (same day): Divo's four round-11.5 requests

### 1. Ghost buttons (Among Us rules)
- Dead CREWMATES keep the USE button and can finish their own tasks
  server-side (`completeTask` no longer throws PLAYER_DEAD for dead crew).
  Ghost task completions count into the shared task bar — among the
  reasons: among the real task-bar semantics of Among Us.
- Dead IMPOSTORS keep the SABOTAGE button + `startSabotage` allows ghosts
  (kill pressure survives death). Ghost KILLS stay blocked
  (impostor ghost can't kill) — `killClient` hides the kill button on death.
- i18n `game.youKilled` rewritten: instead of the outdated
  "Report geht als Geist" line it mentions ghost tasks.

### 2. Role reveal screen stays until tapped
`showRoleOverlay` had a 3-second auto-fade (`ROLE_OVERLAY_MS`). Removed:
the full-screen role card is dismissed EXCLUSIVELY by tapping (beep + hide
in the existing tap handler). The impostor instructions can never slip past
unread again.

### 3. Room-code dashes removed from the game screen
The `#game-code` element (the `——` in the screenshot) always rendered during
a round and only showed a code after a reload. Joining mid-round isn't
allowed anyway: the element is GONE from `#screen-game` and the code lives
only in the lobby.

### 4. Host abort (Divo: "zu früh gestartet, noch jemand soll joinen")
- Server: `roomStore.abortRound(code)` — only valid from IN_GAME, mirrors
  `resetToLobby` but keeps admin auth, positions and boundary strikes
  cleared, map + calibration PRESERVED, everyone stays in the room.
- Wire: `game:abort` (host-only via `assertHost`) clears meeting + sabotage
  timers and broadcasts `room:updated` + `game:reset_done {aborted: true}`.
- Client: `#btn-abort` (!flag icon) next to the gear, HOST + IN_GAME only;
  TWO-TAP confirm (armed state with red pulse CSS, 4s window). On
  `game:reset_done(aborted)` the client resets role/tasks and lands in the
  lobby with toast `game.aborted`.
- New tests: roomStore (ghost tasks / ghost sabotage / abort keeps map) and
  socketServer (guest abort rejected as NOT_ROOM_HOST; host abort works,
  guests stay).

Final: 207 pass / 0 fail. Deploy `?v=19.13.7`, sw `rlaus-shell-v61`.

---

## v19.13.8: Kill-Animation (opfer-sichtbar)
- Neuer Overlay `#kill-anim` — nur das Opfer sieht ihn: CSS-Slash-Sweep + 🗡-Chop + Victim-Bean via `colorChipHex` + „GEKILLT"-Text.
- `showKillAnim()` im `game:killed`-Handler, tap-to-skip, 1600ms + 450ms fade.
- Kill-Privacy bleibt erhalten (nur Opfer + Impostoren erfahren es).
- Sw `rlaus-shell-v62`.

## v19.13.9: Admin-Tisch + i18n-Corruption-Fix
- `roomStore.getAdminTableState(code, playerId)` — Gate: eigene Position muss im ADMIN-Raum sein (`roomId === #adminRoomId(room)`), sonst `NOT_AT_ADMIN_TABLE`.
- Counts = lebende Spieler pro roomId (Gänge/Corpse ausgeschlossen, dead vanish), COMMS-Sabotage → `{blocked:true, counts:{}}`.
- `game:admin_table`-Handler → private `game:admin_table_state`; Client: `useAction()` ADMIN_TABLE-Kind wenn `roomIdContains('ADMIN')`, `openAdminTable/closeAdminTable/drawAdminTable`, Polling 2s, Listener IM `ensureSocket()` (Module-Scope-Bug gefunden und gefixt).
- Overlay-Close bei `meeting_started`/`game:over`/`reset_done`.
- i18n: `game.aborted` war durch `sed` mit `\u`-Escapes korruptiert live („2014 alle zur00fcck") — jetzt korrekt `\u2014`-Escapes.
- Sw `rlaus-shell-v63`.

## v19.14.0: Divo-Meeting-Intro (Meeting-Flow-Überholung)
**Server:**
- `room.undiscoveredDeaths = []` init in `startGame`/`resetToLobby`/`abortRound`.
- `killPlayer` pusht `victim.id` in die Liste (kills ohne gefundene Leiche).
- `reportBody` entfernt alle gefundenen Corpse-Owner-IDs aus der Liste.
- `#publicMeetingInfo` liefert jetzt `meetingKind` (EMERGENCY/REPORT) + `unfoundDeaths [{id,name}]`.
- Neuer Handler `game:meeting_confirm` (assertHost) → Broadcast `game:meeting_confirmed {code}`.

**Client:**
- `#meeting-intro`-Overlay-Statemachine:
  1. **Flash**: report-flash (sfx `report_body`/`emergency_alarm` + Animation „LEICHE GEFUNDEN"/„NOTFALL-MEETING").
  2. **Await**: „Warten auf Bestätigung von Admin…" (in Cafeteria) bzw. „Begib dich zur Cafeteria" (außerhalb) mit 0,8s-Poll + Puls-Dots. Host sieht 2-Tap-Confirm-Button IMMER.
  3. **Reveal**: Reporter+Megaphon 📢 → ☠ ungefundene Tote (skip wenn leer) → „REPORTER darf zuerst reden."-Banner → `renderMeeting` am Ende.
  4. **Failsafe**: ~20s Auto-Proceed. Intro schließt bei VOTING/Meeting-Ende.
- Vote-UI-Rework: Zeilen-Select → grünes ✓-Bestätigen / rotes ✗-Abbrechen → Vote gelockt; SKIP-VOTE-Button; Among-Us-Look (helles Tablet, Bohnen-Chips, tote Zeilen rot-X/gegraut, Reporter-Megaphon; anonyme Votes grau).
- `node --check`, dateiweise Suite, Deploy `?v=19.14.0`, sw `rlaus-shell-v64`.

## v19.14.1: Divo-Log-18-Fixes
- **Round-start Kill-Cooldown**: `lastKillAt` initialisiert auf `Date.now()` bei `startGame` statt `0` → kein Instant-Kill in den ersten Sekunden; echtes `killReadyAt` in `game:role_assigned`.
- **Bots voten verzögert**: 2–6s Denkzeit vor dem Vote (`botVoteDelayMs`, Test-Hook `setVoteDelayForTest(0)`).
- **Countdown sekundengenau**: ISO-String-Parsing in `startVoteCountdown` (NaN-Bug gefixt), Diskussion und Voting ticken in Sekunden.
- **Öffentliches VotedIds**: `votedIds` im öffentlichen Meeting-Info → grauer ✓-Chip pro Spieler (wer hat gevotet, Ziel bleibt anonym).
- **game:killed setzt lokale Aliveness**: Opfer wird sofort auf `isAlive=false` gesetzt → kein PLAYER_DEAD-Spam mehr beim Report-Button.
- **Geister**: spectate-only Vote-Liste, Report-Guard („Geister können nicht melden").
- **Host-Bestätigung überlebt 0,8s-Poll**: Await-Content zeichnet nur bei echtem Zustandswechsel neu; Arming-Fenster 3,2s.
- Deploy `?v=19.14.1`, sw `rlaus-shell-v65`.

## v19.14.2: Corpse-Cleanup bei Meeting-Ende
- `endMeeting()` leert `room.corpses = []` — nach JEDEM Meeting (Report oder Notfall) sind alte Leichen weg und nicht mehr reportbar (`NO_BODY_NEARBY`).
- `undiscoveredDeaths` Ledger überlebt für das Intro-Reveal.
- 2 neue Regressionstests (Re-Report nach Report-Meeting → NO_BODY_NEARBY; Emergency-Meeting → Straßen-Leiche weg, Ledger intakt).
- Server-only Deploy, Client bleibt `?v=19.14.1`.

## v19.15.0: Meeting-Flow v2 (Divo-Wunsch: direkter Cafeteria-Flow)
- **Kurze Flash-Animation** (LEICHE GEFUNDEN / NOTFALL-MEETING) → direkt **„Zur Cafeteria"-Meldung** statt langem Intro.
- **HUD-Sperre** während Await: Report/Use/Kill-Knöpfe ausgeblendet, stattdessen „Begib dich zur Cafeteria"-Meldung.
- **Roter blinkender Cafeteria-Beacon** auf der Map (am Meeting-Tisch) bis zur Bestätigung.
- **Admin-Bestätigung mit Live-Zähler**: X/Y in Cafeteria + Z Geister getrennt angezeigt. Doppelt-Tap-Arming (3,2s).
- **Keine Zwangsvollständigkeit**: Host bestätigt unabhängig davon, wie viele da sind.
- **Reveal** nach Bestätigung (wer, ungefundene Tote, Reporter zuerst) → Voting.
- Server: `meetingAdminCount` im öffentlichen `room:updated` während Meeting-Await (live Zähler).
- `meetingIntroSynced`-Guard verhindert doppelten Intro-Start.
- i18n de/en komplett.
- Deploy `?v=19.15.0`, sw `rlaus-shell-v66`.

## v19.15.1: Reconnect-Schutz für Meeting-Intro
- `game:meeting_started` kommt nur einmal — späte Joiner/Neuladen während Meeting bekamen kein Intro.
- Neu: `room.meeting.confirmed` tracked Host-Bestätigung, wird im öffentlichen Meeting-Info ausgegeben (`meetingConfirmed`).
- Client rekonstruiert bei `room:updated` während Meeting den Zustand: Await mit Zähler ODER direkt Voting-Tafel.
- `startMeetingIntroLate()` für späten Joiner (registriert auch `meetingConfirmHandler`).
- `renderMeeting` startet Voting-Countdown für späte Joiner (Fall-back `state.room?.votingDeadline`).
- `meetingIntroSynced` auf `state`-Ebene konsistent, wird bei `game:over`/`reset_done` zurückgesetzt.
- Deploy `?v=19.15.1`, sw `rlaus-shell-v67`.

## v19.16.0: Meeting UI Overhaul
- **Vereinfachter Intro**: Flash → Await „Zur Cafeteria" → kurzer Reveal → Voting (weniger Text, übersichtlicher).
- **Voting Results Overlay** 4,5s: namentlich (nicht-anonym) oder anonym (nur Anzahl + Bohnen-Chips), „Proceeding in: Xs".
- **Sabotage-Button hell wenn aktiv**: Button bleibt enabled bei laufender Sabotage, lila Pulse-Animation, Restzeit auf dem Knopf.
- **Voting-Panel ausgegraut während Diskussion**: Karten grau + `pointer-events: none`, erst beim Voting normal.
- **Impostor kann keine Tasks**: Toast „Impostoren erledigen keine Tasks", Task startet nicht (nur anzeigen).
- **Voted.png Badge**: Statt ✓-Text nun Bild-Badge aus `Button_Pic/Voted.png`.
- **Diskussions-Countdown sekundengenau**: „Diskussion endet in: Xs".
- i18n de/en komplett für alle neuen Keys.
- 72 roomStore-Tests grün.
- Deploy `?v=19.16.0`, sw `rlaus-shell-v69`.

## v19.16.1: Map & Sabotage Fixes (Divo Log 27)
- **Sabotage-Fix-Zeit 30s → 90s** (IRL braucht man länger zum Fixen).
- **Sabotage-Cooldown 15s → 30s** (nach kritischer Sabotage) / **45s → 60s** (nicht-kritisch).
- **Position-Plausibilität 8 → 12 m/s**: weniger `POSITION_UNREALISTIC`-False-Positives durch GPS-Sprünge.
- **Task-Marker kleiner** (Radius 16 → 10), kein Pulsieren mehr → Map übersichtlicher, Namen nicht mehr überdeckt.
- **Cafeteria-Tisch deutlicher hervorgehoben** mit „CAFETERIA"-Label unter dem Tisch.
- Deploy `?v=19.16.1`, sw `rlaus-shell-v70`.

## v19.16.3: Map-Raumnamen außerhalb mit Pfeil
- **Raumnamen nicht mehr im Polygonzentrum** (wurden von Tasks überdeckt), sondern oberhalb der Raum-Box mit **dünnem Pfeil zum Zentrum**.
- **Pfeile dicker** (lineWidth 3) und zeigen vom **Namen zum Raum** (Pfeilspitze am Raum).
- **Individuelle Platzierung pro Raum**: Admin nach rechts, Medbay nach unten, O2/Reactor/Nav/Shields/Comms/Storage/Weapons/Security mit eigenen Offsets.
- **Cafeteria ausgenommen** (bereits Tisch-Label, kein Doppel-Label).
- Deploy `?v=19.16.3`, sw `rlaus-shell-v72`.

---

## Kumulierter Stand (alle Deployments)
- Client: `?v=19.16.3`, sw `rlaus-shell-v72`
- Server: alle Commits bis `2f2e848` auf `main`
- Tests: 189 pass / 0 fail (roomStore 72, socketServer 27, positioning 83, map 22, bots 7, gates 5)
- Demo-Server: `https://real-life-among-us-beta.onrender.com` (Render free → Restart löscht Räume + Sessions)
- Ntfy nach jedem Deploy via `scripts/notify.sh`

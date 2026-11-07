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

/**
 * PWA app shell: start screen, lobby, map editor and the in-game HUD.
 * All server interaction runs through Socket.IO with the same event
 * protocol as the Flutter client. UI language: German.
 */
'use strict';

const App = (() => {
  const $ = (id) => document.getElementById(id);

  const screens = {
    home: $('screen-home'),
    lobby: $('screen-lobby'),
    map: $('screen-map'),
    game: $('screen-game'),
  };

  const state = {
    socket: null,
    name: '',
    playerId: '',
    token: '',
    code: '',
    isHost: false,
    room: null, // last public room snapshot
    role: null, // role payload from game:role_assigned
    killReadyAt: 0,
    voted: false,
  };

  const editor = new MapEditor($('map-canvas'), {
    onSelectionChanged: (count) => {
      $('btn-build-streets').disabled = count === 0;
      $('map-status').textContent = `${count} Abschnitte ausgew\u00E4hlt`;
    },
  });

  // ------------------------------------------------------------- helpers //

  function show(name) {
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('active', key === name);
    }
  }

  function errorHome(message) {
    const el = $('home-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function beep(freq = 660, durationMs = 140) {
    try {
      if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = App.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (_) { /* audio not available */ }
  }

  function randomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  function uuid() {
    return crypto.randomUUID?.() ?? `p${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  function ensureSocket() {
    if (state.socket) return state.socket;
    const socket = io();
    socket.on('room:updated', (room) => {
      state.room = room;
      if (room.code) state.code = room.code;
      state.isHost = room.hostId === state.playerId;
      renderLobbyPlayers(room);
      renderPhaseHint(room);

      // Only auto-route when the user is not already in a deeper screen.
      const active = document.querySelector('.screen.active')?.id;
      if (room.status === 'LOBBY' && active !== 'screen-lobby') {
        show('lobby');
      }
      if (room.status === 'GAME_OVER' || room.status === 'IN_GAME' || room.status === 'MEETING') {
        if (active !== 'screen-game') show('game');
      }
      // GPS-Sender nur während des echten Spiels (Kill-Gates brauchen Positionen).
      if (room.status === 'IN_GAME') ensureGpsLoop();
      else stopGpsLoop();
      renderTeamProgress(room);
      drawGameMap();
      // MAP_READY: the host may go back to the lobby and start the game.
      const startGame = $('btn-start-game');
      const canStart = room.status === 'MAP_READY' && state.isHost;
      startGame.disabled = !canStart;
      if (room.status === 'MAP_READY') {
        startGame.textContent = 'Spiel starten';
      } else if (state.isHost) {
        startGame.textContent = room.status === 'LOBBY' ? 'Erst Karte laden' : 'Karte wird gebaut\u2026';
      }
      if (room.status === 'MAP_SETUP' && state.pendingCachedLoad) {
        state.pendingCachedLoad = false;
        // Stored map available -> straight into load + save (skip Overpass).
        const cached = readSavedLocalMap();
        if (cached) {
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { version: cached.version + 1, nodes: cached.nodes, corridors: cached.corridors, rooms: cached.rooms ?? [], connections: [] },
    });
    ensureSocket().emit('map:save', {
      code: state.code,
      map: { version: cached.version + 2, nodes: cached.nodes, corridors: cached.corridors, rooms: cached.rooms ?? [], connections: [] },
    });
          showToast('Gespeicherte Karte \u00fcbernommen.');
        } else {
          showToast('Keine gespeicherte Karte auf dem Ger\u00e4t \u2014 Stra\u00dfen laden.');
        }
      }
      if (room.status === 'MAP_READY' && active === 'screen-map') {
        show('lobby');
      }
    });
    socket.on('session:created', ({ code, playerId, token }) => {
      Object.assign(state, { code, playerId, token });
      localStorage.setItem('rlaus_session', JSON.stringify({ code, playerId, token, name: state.name }));
    });
    // The server only sends room:created to the host's own socket
    // (no broadcast), so it routes hosts into the lobby directly.
    socket.on('room:created', (room) => {
      state.room = room;
      state.isHost = room.hostId === state.playerId;
      renderLobby(room);
      show('lobby');
    });
    socket.on('room:error', ({ code: _error, message }) => {
      if (screens.home.classList.contains('active')) {
        errorHome(message ?? 'Aktion fehlgeschlagen.');
      } else {
        showToast(message ?? 'Aktion fehlgeschlagen.');
      }
    });
    socket.onAny((event) => console.debug('[socket]', event));

    socket.on('game:started', () => {
      show('game');
      beep(520);
    });
    socket.on('game:kill_targets', ({ targets }) => {
      state.killTargets = targets ?? [];
      renderGameHud();
    });
    socket.on('game:sabotage_started', ({ code: _code, type, deadline }) => {
      if (state.room) state.room.sabotage = { type, deadline, ...(type === 'O2' ? { panels: { o2: false, admin: false } } : {}) };
      beep(type === 'REACTOR' ? 120 : 240);
      vibrate([80, 60, 80, 60, 160]);
      renderSabotage();
    });
    socket.on('game:sabotage_fixed', ({ code: _code }) => {
      if (state.room) delete state.room.sabotage;
      $('sabotage-banner').classList.add('hidden');
      beep(700);
      renderGameHud();
    });
    socket.on('game:bodies_nearby', ({ bodies }) => {
      state.nearbyBodies = bodies ?? [];
      renderGameHud();
      drawGameMap();
    });
    socket.on('position:confirmed', (pos) => {
      state.selfPos = pos;
      state.anchorOk = !!pos.onCorridor || !!pos.onRoom;
      // Zurück im Spielfeld -> Warnbanner ausblenden.
      if (state.selfPos.onCorridor || state.selfPos.onRoom) {
        $('boundary-banner').classList.add('hidden');
      }
      drawGameMap();
      renderGameHud();
    });
    socket.on('position:error', ({ code }) => {
      if (code === 'POSITION_NOT_ALLOWED') return; // Meeting etc. – ruhig ignorieren
      $('game-phase-hint').textContent = `Position abgelehnt: ${code}`;
    });
    socket.on('game:boundary_warning', ({ distanceM, limitM, strikes }) => {
      const banner = $('boundary-banner');
      banner.textContent = `Geh zur\u00fcck aufs Spielfeld! (${Math.round(distanceM)}m > ${Math.round(limitM)}m) Warnung ${strikes}/3`;
      banner.classList.remove('hidden');
      vibrate([60, 40, 60, 40, 120]);
    });
    socket.on('admin:player_out_of_bounds', ({ name, distanceM }) => {
      const banner = $('boundary-banner');
      banner.textContent = `ADMIN: ${name} ist ${Math.round(distanceM)}m drau\u00dfen!`;
      banner.classList.remove('hidden');
      vibrate([200, 100, 200]);
    });
    socket.on('game:role_assigned', (payload) => {
      state.role = payload;
      state.killReadyAt = payload.killReadyAt ?? 0;
      state.teammates = payload.teammates ?? [];
      showRoleOverlay(payload);
      ensureGpsLoop();
      vibrate([60, 60, 120]);
    });
    socket.on('game:kill_cooldown', ({ killReadyAt }) => {
      state.killReadyAt = killReadyAt;
    });
    socket.on('game:killed', ({ killedPlayerId }) => {
      beep(200, 320);
      vibrate([200, 80, 200]);
      if (killedPlayerId === state.playerId) {
        $('game-phase-hint').textContent = 'Du wurdest eliminiert! Beobachte weiter — Report geht als Geist.';
      } else {
        $('game-phase-hint').textContent = 'Jemand wurde eliminiert. Halte die Augen offen!';
      }
    });
    socket.on('game:meeting_started', (payload) => renderMeeting(payload));
    socket.on('game:voting_started', ({ votingDeadline }) => {
      $('meeting-title').textContent = 'Abstimmung!';
      $('meeting-hint').textContent = deadlineText(votingDeadline);
    });
    socket.on('game:vote_progress', ({ votedCount, totalVoters }) => {
      $('meeting-hint').textContent = `Abstimmen: ${votedCount}/${totalVoters}`;
    });
    socket.on('game:meeting_result', ({ ejectedPlayerId, ejectedPlayerName, status }) => {
      $('meeting-overlay').classList.add('hidden');
      state.voted = false;
      if (ejectedPlayerId === state.playerId) {
        $('role-banner').textContent = 'Du bist raus (bot)';
        vibrate([120, 60, 120]);
      } else if (ejectedPlayerName) {
        $('game-phase-hint').textContent = `${ejectedPlayerName} wurde rausgew\u00e4hlt.`;
      } else {
        $('game-phase-hint').textContent = 'Niemand wurde rausgew\u00e4hlt (Skip).';
      }
      if (status === 'GAME_OVER') stopGpsLoop();
      else if (status === 'IN_GAME') ensureGpsLoop();
    });
    socket.on('game:over', ({ winner, players }) => {
      stopGpsLoop();
      $('boundary-banner').classList.add('hidden');
      $('gameover-overlay').classList.remove('hidden');
      $('gameover-title').textContent =
        winner === 'CREWMATE' ? 'Crewmates haben gewonnen!' : 'Impostoren haben gewonnen!';
      const alivePlayers = (players ?? []).filter((p) => p.isAlive).map((p) => p.name);
      $('gameover-detail').textContent = `Am Ende \u00fcbrig: ${alivePlayers.join(', ')}`;
      $('btn-rematch').classList.toggle('hidden', !state.isHost);
    });
    socket.on('task:progress', ({ completedTaskId }) => {
      if (!completedTaskId) return;
      if ((state.role?.tasks ?? []).some((t) => t.id === completedTaskId)) {
        const task = state.role.tasks.find((t) => t.id === completedTaskId);
        if (task) task.completed = true;
        showToast(task?.isFake ? 'Fake-Task abgehakt (kein Fortschritt \u2014 t\u00e4usche weiter!).' : 'Task erledigt!');
        beep(880);
        vibrate(50);
      }
      drawGameMap();
      renderGameHud();
    });
    socket.on('disconnect', () => {
      // Socket.IO reconnects automatically; try to rejoin when back.
      socket.once('connect', () => tryRejoin());
    });

    state.socket = socket;
    return socket;
  }

  function hideOverlaysNot() {
    $('gameover-overlay').classList.add('hidden');
  }

  function deadlineText(deadline) {
    if (!deadline) return 'Zeit l\u00e4uft\u2026';
    return `Bis ${new Date(deadline).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function tryRejoin() {
    const saved = JSON.parse(localStorage.getItem('rlaus_session') ?? 'null');
    if (!saved) return;
    state.name = saved.name ?? state.name;
    Object.assign(state, { code: saved.code, playerId: saved.playerId, token: saved.token });
    state.socket.emit('room:rejoin', { code: saved.code, playerId: saved.playerId, token: saved.token });
  }

  // ---------------------------------------------------------------- home //

  async function joinRoom({ asHost }) {
    const name = $('player-name').value.trim() || 'Spieler';
    state.name = name;
    localStorage.setItem('rlaus_name', name);
    ensureSocket();

    if (asHost) {
      const playerId = uuid();
      state.playerId = playerId;
      state.socket.emit('room:create', {
        code: randomCode(),
        hostId: playerId,
        hostName: name,
      });
    } else {
      const code = $('join-code').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        errorHome('Code hat 6 Zeichen (Buchstaben/Zahlen, ohne l/I/O/1).');
        return;
      }
      state.playerId = uuid();
      state.socket.emit('room:join', {
        code,
        playerId: state.playerId,
        playerName: name,
      });
    }

    // The room:updated handler routes to the lobby automatically; nothing
    // else to do here.
  }

  $('player-name').value = localStorage.getItem('rlaus_name') ?? '';
  $('btn-host').addEventListener('click', () => joinRoom({ asHost: true }));
  $('btn-join').addEventListener('click', () => joinRoom({ asHost: false }));
  $('btn-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.code); } catch (_) {}
    $('btn-share').textContent = 'Kopiert!';
    setTimeout(() => ($('btn-share').textContent = 'Code kopieren'), 1200);
  });
  $('btn-bot-add').addEventListener('click', () => {
    ensureSocket().emit('game:bot_add', { code: state.code, count: 1 });
  });
  $('btn-bot-remove').addEventListener('click', () => {
    ensureSocket().emit('game:bot_remove', { code: state.code });
  });

  $('btn-leave').addEventListener('click', () => {
    localStorage.removeItem('rlaus_session');
    state.socket?.disconnect();
    state.room = null;
    show('home');
  });

  // --------------------------------------------------------------- lobby //

  function renderLobby(room) {
    const isHost = room.hostId === state.playerId;
    state.isHost = isHost;
    $('host-controls').classList.toggle('hidden', !isHost);
    applyLobbyConfig(room);
    $('lobby-waiting').classList.toggle('hidden', isHost);
    $('lobby-code').textContent = room.code;
    renderLobbyPlayers(room);
    refreshCachedMapButton();
  }

  function renderLobbyPlayers(room) {
    const list = $('lobby-players');
    list.innerHTML = '';
    for (const player of room.players) {
      const li = document.createElement('li');
      const badge = player.id === room.hostId
        ? 'Host'
        : player.isBot
          ? 'Bot'
          : player.isAlive
            ? 'bereit'
            : 'ausgeschieden';
      const isMate = (state.teammates ?? []).some((m) => m.id === player.id);
      li.innerHTML = `<span${isMate ? ' class="imp-name"' : ''}>${escapeHtml(player.name)}${player.isBot ? ' \u{1F916}' : ''}</span><span class="badge">${badge}</span>`;
      list.appendChild(li);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  $('btn-edit-map').addEventListener('click', () => {
    ensureSocket().emit('map:start', { code: state.code });
    show('map');
    $('map-status').textContent = 'Position suchen\u2026';
    refreshCachedMapButton();
    // Rooms aus dem letzten Stand \u00fcbernehmen, wenn schon welche existieren.
    editor.setRooms(state.room?.map?.rooms ?? []);
  });
  $('btn-map-back').addEventListener('click', () => show(state.room.status === 'MAP_READY' || state.room.status === 'MAP_SETUP' ? 'lobby' : 'home'));
  $('btn-start-game').addEventListener('click', () => {
    if (!state.room?.map) {
      alert('Erst eine Karte speichern!');
      return;
    }
    ensureSocket().emit('game:start', { code: state.code });
  });

  // ---------------------------------------------------------- map editor //

  // Device-local map cache: saving a map also stores it on the phone, so the
  // next session skips the 10-40 s Overpass fetch entirely.
  const SAVED_MAP_KEY = 'rlaus.savedMap.v1';

  function readSavedLocalMap() {
    try {
      const map = JSON.parse(localStorage.getItem(SAVED_MAP_KEY) ?? 'null');
      // Anchor may be missing from very old saves; loading still works,
      // GPS projection just needs a fresh anchor in that case.
      if (!map?.nodes?.length || !map?.corridors?.length) return null;
      return map;
    } catch {
      return null;
    }
  }

  function refreshCachedMapButton() {
    const cached = readSavedLocalMap();
    const editorButton = $('btn-load-cached');
    const lobbyButton = $('btn-load-cached-lobby');
    if (!cached) {
      editorButton.hidden = true;
      lobbyButton.hidden = true;
      return;
    }
    const date = new Date(cached.savedAt).toLocaleDateString('de-DE');
    const label = `\u2913 Gespeicherte Karte laden (${cached.nodes.length} Knoten, ${date})`;
    editorButton.hidden = false;
    editorButton.textContent = label;
    lobbyButton.hidden = false;
    lobbyButton.textContent = label;
  }

  /** Loads the device-local map into the editor and pushes it to the room. */
  function applyCachedMap() {
    const cached = readSavedLocalMap();
    if (!cached) return;
    if (Number.isFinite(cached.anchor?.lat)) {
      editor.setAnchor(cached.anchor.lat, cached.anchor.lon);
    } else {
      showToast('Karte ohne GPS-Anker \u2014 im Spiel evtl. keine Positionsdaten.');
    }
    const working = {
      version: cached.version + 1,
      nodes: cached.nodes,
      corridors: cached.corridors,
    };
    editor.setWorking(working);
    editor.setRooms(cached.rooms ?? []);
    editor.selected.clear();
    $('btn-build-streets').disabled = true;
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { ...working, rooms: [], connections: [] },
    });
    $('map-status').textContent = `Gespeicherte Karte geladen (${working.nodes.length} Knoten) \u2014 erweitern oder speichern`;
  }

  // Lobby shortcut: skips the editor entirely (map:start -> MAP_SETUP -> load+save).
  $('btn-load-cached-lobby').addEventListener('click', () => {
    state.pendingCachedLoad = true;
    ensureSocket().emit('map:start', { code: state.code });
    showToast('Lade gespeicherte Karte\u2026');
  });

  $('btn-load-cached').addEventListener('click', () => {
    applyCachedMap();
  });

  $('btn-load-streets').addEventListener('click', async () => {
    if (!('geolocation' in navigator)) {
      $('map-status').textContent = 'Kein GPS auf diesem Ger\u00e4t.';
      return;
    }
    $('btn-load-streets').disabled = true;
    $('map-spinner').classList.remove('hidden');
    $('map-status').textContent = 'GPS-Fix wird gesucht\u2026';
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        });
      });
      const { latitude, longitude } = position.coords;
      $('map-status').textContent = `\u00b1${Math.round(position.coords.accuracy)}m Genauigkeit \u2014 Stra\u00DFen laden (dauert 10\u201340s, Bildschirm offen halten)\u2026`;
      editor.setAnchor(latitude, longitude);
      const radius = Number($('map-radius').value);
      // Browser fetches Overpass directly (Render egress is unreliable);
      // osm.js handles the mirror fallback + 40s timeouts. Overpass is
      // often overloaded, so retry automatically up to three rounds.
      let streets = null;
      let lastError = null;
      for (let attempt = 1; attempt <= 3 && !streets; attempt++) {
        $('map-status').textContent =
          attempt === 1
            ? 'Stra\u00DFen laden (dauert 10\u201340\u2009s, Bildschirm offen halten)\u2026'
            : `Versuch ${attempt}: Overpass ist \u00fcberlastet, nochmal\u2026`;
        try {
          streets = await OSM.fetchStreets(latitude, longitude, radius);
        } catch (error) {
          lastError = error;
        }
      }
      if (!streets) throw lastError;
      const candidates = OSM.toCandidates(streets, { lat: latitude, lon: longitude });
      // Whole OSM ways are too long to select: split at real junctions so
      // tapping picks street blocks instead of an entire through street.
      const pieces = OSM.splitCandidatesAtJunctions(candidates);
      editor.setCandidates(pieces);
      $('map-status').textContent = `${pieces.length} Abschnitte aus ${candidates.length} Stra\u00DFen geladen \u2014 antippen zum Ausw\u00e4hlen`;
      if (!pieces.length) $('map-status').textContent = 'Keine Stra\u00DFen gefunden \u2014 Radius erh\u00f6hen?';
    } catch (error) {
      $('map-status').textContent = `Fehler: ${error.message}`;
    } finally {
      $('btn-load-streets').disabled = false;
      $('map-spinner').classList.add('hidden');
    }
  });

  $('btn-build-streets').addEventListener('click', () => {
    const selected = editor.getSelectedCandidates();
    if (!selected.length) return;
    const working = OSM.buildMapFromCandidates(selected, editor.working);
    editor.setWorking(working);
    ensureSocket().emit('map:update', {
      code: state.code,
      map: {
        ...working,
        rooms: editor.rooms,
        connections: [],
      },
    });
    const nodeCount = working.nodes.length;
    const corridorCount = working.corridors.length;
    $('map-status').textContent = `${nodeCount} Knoten, ${corridorCount} Verbindungen \u2014 weiter antippen oder speichern`;
    editor.selected.clear();
    $('btn-build-streets').disabled = true;
  });

  // ------------------------------------------------------------- rooms //

  editor.onRoomDraft = (polygonPts) => {
    if (polygonPts.length < 3) {
      editor.discardRoom();
      showToast('Raum braucht mindestens 3 Punkte.');
      return;
    }
    $('room-name-input').value = '';
    $('room-type-select').value = 'NORMAL';
    $('room-form').classList.remove('hidden');
    $('room-name-input').focus();
  };

  $('btn-room-mode').addEventListener('click', () => {
    editor.setRoomMode(!editor.roomMode);
    $('room-form').classList.add('hidden');
    $('btn-room-mode').classList.toggle('primary', editor.roomMode);
    $('btn-room-mode').textContent = editor.roomMode
      ? 'Raummodus beenden'
      : 'Raum zeichnen';
    $('map-hint').textContent = editor.roomMode
      ? 'Tippe Punkte f\u00fcr den Raum. Tippe den ersten Punkt erneut, um zu schlie\u00dfen.'
      : 'Tippe eine Stra\u00dfe an, um sie auszuw\u00e4hlen.';
  });

  $('btn-room-undo').addEventListener('click', () => editor.undoRoomPoint());
  $('btn-room-discard').addEventListener('click', () => {
    editor.discardRoom();
    $('room-form').classList.add('hidden');
  });
  $('btn-room-confirm').addEventListener('click', () => {
    const name = $('room-name-input').value.trim() || 'Raum';
    const type = $('room-type-select').value || 'NORMAL';
    const room = editor.commitRoom(name, type);
    if (!room) {
      showToast('Raum braucht mindestens 3 Punkte.');
      return;
    }
    $('room-form').classList.add('hidden');
    $('btn-room-mode').classList.remove('primary');
    $('btn-room-mode').textContent = 'Raum zeichnen';
    $('map-hint').textContent = `Raum "${room.name}" angelegt (${editor.rooms.length} total).`;
    ensureSocket().emit('map:update', {
      code: state.code,
      map: {
        ...editor.working,
        rooms: editor.rooms,
        connections: [],
      },
    });
    beep(880);
  });

  $('btn-map-save').addEventListener('click', () => {
    const working = editor.working;
    if (!working.nodes.length) {
      $('map-status').textContent = 'Map ist leer \u2014 erst Stra\u00DFen laden und \u00fcbernehmen.';
      return;
    }
    ensureSocket().emit('map:save', {
      code: state.code,
      map: { ...working, rooms: editor.rooms, connections: [] },
    });
    // Local copy for the next round: skip Overpass entirely.
    try {
      localStorage.setItem(
        SAVED_MAP_KEY,
        JSON.stringify({
          version: working.version,
          nodes: working.nodes,
          corridors: working.corridors,
          rooms: editor.rooms,
          anchor: editor.anchor,
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Private mode / quota: server save still worked, just no cache.
    }
    alert('Karte gespeichert! Zur\u00fcck in die Lobby \u2014 dann Spiel starten.');
    show('lobby');
  });

  $('btn-map-clear').addEventListener('click', () => {
    if (!confirm('Alle Stra\u00DFen und Knoten l\u00f6schen?')) return;
    editor.clearWorking();
    editor.setRooms([]);
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { version: 1, nodes: [], corridors: [], rooms: [], connections: [] },
    });
    $('map-status').textContent = 'Karte entleert.';
  });

  $('btn-zoom-in').addEventListener('click', () => editor.zoomBy(1.4));
  $('btn-zoom-out').addEventListener('click', () => editor.zoomBy(1 / 1.4));
  $('map-radius').addEventListener('change', () => {});

  // ------------------------------------------------------- settings (host) //

  function applyLobbyConfig(room) {
    const cfg = room.config ?? {};
    $('cfg-impostors').value = `${cfg.impostorCount ?? 1}`;
    $('cfg-tasks').value = `${cfg.tasksPerCrewmate ?? 4}`;
    $('cfg-kill-radius').value = `${cfg.killRadiusM ?? 2}`;
    $('cfg-cooldown').value = `${Math.round((cfg.killCooldownMs ?? 0) / 1000)}`;
    $('cfg-discuss').value = `${Math.round((cfg.discussionDurationMs ?? 0) / 1000)}`;
    $('cfg-vote').value = `${Math.round((cfg.votingDurationMs ?? 60_000) / 1000)}`;
  }

  $('cfg-apply').addEventListener('click', () => {
    ensureSocket().emit('game:update_config', {
      code: state.code,
      config: {
        impostorCount: Number($('cfg-impostors').value),
        tasksPerCrewmate: Number($('cfg-tasks').value),
        killRadiusM: Number($('cfg-kill-radius').value),
        killCooldownMs: Number($('cfg-cooldown').value) * 1000,
        discussionDurationMs: Number($('cfg-discuss').value) * 1000,
        votingDurationMs: Number($('cfg-vote').value) * 1000,
      },
    });
    beep(660);
  });

  // ---------------------------------------------------------------- game //

  const ROLE_OVERLAY_MS = 3000;

  /** Among-Us-like full-screen role card: shows a few seconds, then fades. */
  function showRoleOverlay(payload) {
    const overlay = $('role-overlay');
    const impostor = payload.role === 'IMPOSTOR';
    $('role-card').className = impostor ? 'role-card impostor' : 'role-card crew';
    $('role-card-title').textContent = impostor ? 'IMPOSTOR' : 'CREWMATE';
    const mates = (payload.teammates ?? []).map((t) => t.name).join(', ');
    $('role-card-detail').textContent = impostor
      ? mates
        ? `Dein Partner: ${mates}`
        : 'Du arbeitest allein.'
      : `${payload.tasks?.length ?? 0} Tasks warten \u2014 Fake-Tasks f\u00fcr Impostoren z\u00e4hlen nicht.`;
    overlay.classList.remove('hidden');
    $('role-banner').classList.add('hidden');
    $('btn-kill').classList.toggle('hidden', !impostor);
    renderRole(payload); // task list build + flags + teammates line

    window.clearTimeout(showRoleOverlay._t);
    showRoleOverlay._t = window.setTimeout(() => {
      overlay.classList.add('hidden');
      beep(impostor ? 180 : 560);
    }, ROLE_OVERLAY_MS);
  }

  function renderRole(payload) {
    const impostor = payload.role === 'IMPOSTOR';
    $('btn-kill').classList.toggle('hidden', !impostor);
    const teammates = $('teammates');
    if (impostor && payload.teammates?.length) {
      teammates.textContent = `Impostor-Partner: ${payload.teammates.map((t) => t.name).join(', ')}`;
      teammates.classList.remove('hidden');
    } else {
      teammates.classList.add('hidden');
    }

    // Build task list (crewmates), impostors can still get fake tasks.
    const list = $('task-list');
    list.innerHTML = '';
    for (const task of payload.tasks ?? []) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(task.title)}</span>`;
      const button = document.createElement('button');
      button.textContent = 'Erledigt';
      button.className = 'primary small';
      button.addEventListener('click', () => {
        ensureSocket().emit('task:complete', { code: state.code, taskId: task.id });
        button.disabled = true;
        button.textContent = '\u2713';
        beep(880);
        vibrate(30);
      });
      li.appendChild(button);
      list.appendChild(li);
    }
    $('task-count').textContent = `${payload.tasks?.length ?? 0}`;
    if (!payload.tasks?.length) {
      list.innerHTML = '<li><span>Keine Tasks \u2014 als Impostor sabotier, als Geist beobachte.</span></li>';
    }
    renderGameHud();
  }

  /** Team-Fortschritt im Live-Map-Header (aus room.taskProgress). */
  function renderTeamProgress(room) {
    const progress = room.taskProgress ?? { completed: 0, total: 0 };
    const total = progress.total || 0;
    const pct = total ? Math.round((progress.completed / total) * 100) : 0;
    $('team-progress-bar').style.width = `${pct}%`;
  }

  /** Report/Kill-Buttons je nach Nähe (Kill nur mit echten Zielen). */
  function renderGameHud() {
    const room = state.room;
    if (!room || room.status !== 'IN_GAME') return;
    const imAlive = room.players.find((p) => p.id === state.playerId)?.isAlive;
    const bodies = state.nearbyBodies ?? [];
    const reportBtn = $('btn-report');
    reportBtn.disabled = !(bodies.length && imAlive !== false);
    reportBtn.classList.toggle('ready', bodies.length > 0 && imAlive !== false);
    const killBtn = $('btn-kill');
    if (!killBtn.classList.contains('hidden')) {
      const targets = state.killTargets ?? [];
      const cooldownLeft = Math.max(0, state.killReadyAt - Date.now());
      killBtn.disabled = !targets.length || cooldownLeft > 0;
      killBtn.classList.toggle('ready', targets.length > 0 && cooldownLeft <= 0);
      killBtn.textContent = cooldownLeft && targets.length
        ? `${Math.ceil(cooldownLeft / 1000)}s`
        : 'Kill';
    }
    updateUseButton();
    updateSabotageButton();
  }

  /** Use-Knopf: Sabotage-Fix > Task > Notfall-Meeting (nur wenn anw\u00e4hlbar). */
  function useAction() {
    if (state.room?.status !== 'IN_GAME') return null;
    const sab = state.room?.sabotage;
    const roomId = state.selfPos?.roomId;
    if (sab) {
      if (sab.type === 'REACTOR' && roomIdContains('REACTOR')) {
        return { label: 'Fix', kind: 'FIX', panel: 'REACTOR' };
      }
      if (sab.type === 'O2') {
        if (!sab.panels?.o2 && roomIdContains('O2')) {
          return { label: 'Fix O2', kind: 'FIX', panel: 'o2' };
        }
        if (!sab.panels?.admin && roomIdContains('ADMIN')) {
          return { label: 'Fix Admin', kind: 'FIX', panel: 'admin' };
        }
      }
      return null;
    }
    const task = nearestIncompleteTask();
    if (task) {
      return { label: 'Task', kind: 'TASK', task };
    }
    if (roomIdContains('CAFETERIA') && emergencyLeft() > 0) {
      return { label: 'Notfall', kind: 'EMERGENCY' };
    }
    return null;
  }

  function roomIdContains(type) {
    const roomId = state.selfPos?.roomId;
    const room = (state.room?.map?.rooms ?? []).find((r) => r.id === roomId);
    return room?.type === type;
  }

  /** Innerhalb 4 m (Server-Gate) des n\u00e4chsten offenen Tasks. */
  function nearestIncompleteTask() {
    const self = state.selfPos;
    if (!self) return null;
    let best = null;
    let bestDist = Infinity;
    for (const task of state.role?.tasks ?? []) {
      if (task.completed || task.x == null) continue;
      const d = Math.hypot((self.x ?? Infinity) - task.x, (self.y ?? Infinity) - task.y);
      if (d < bestDist) {
        bestDist = d;
        best = task;
      }
    }
    return bestDist <= 4.2 ? best : null;
  }

  function emergencyLeft() {
    // Der Server z\u00e4hlt (emergencyUsed) \u2014 lokal tasten wir 1 pro Spieler.
    return state.role && !(state._usedEmergency) ? 1 : 0;
  }

  function updateUseButton() {
    const useBtn = $('btn-use');
    const action = useAction();
    useBtn.textContent = action ? action.label : 'Use';
    const inMeeting = state.room?.status !== 'IN_GAME';
    const dead = state.room?.players?.find((p) => p.id === state.playerId) ?.
      isAlive === false;
    useBtn.classList.toggle('hidden', !state.room || inMeeting || dead);
    useBtn.disabled = !action || inMeeting || dead;
    useBtn.classList.toggle('ready', !!action && !inMeeting);
    useBtn.dataset.kind = action?.kind ?? '';
  }

  function updateSabotageButton() {
    const sabBtn = $('btn-sabotage');
    if (!sabBtn) return;
    const impostor = state.role?.role === 'IMPOSTOR';
    sabBtn.classList.toggle('hidden', !impostor || state.room?.status !== 'IN_GAME');
    if (!impostor) return;
    sabBtn.disabled = !!state.room?.sabotage;
    sabBtn.textContent = state.room?.sabotage ? 'L\u00e4uft' : 'Sabotage';
  }
  setInterval(renderGameHud, 500);

  // -------------------------------------------------------- sabotage HUD //

  /** Overlay banner during active sabotage with live countdown. */
  function renderSabotage() {
    const banner = $('sabotage-banner');
    const sab = state.room?.sabotage;
    if (!sab || state.room?.status !== 'IN_GAME') {
      banner.classList.add('hidden');
      return;
    }
    const remaining = Math.max(0, Math.round((Date.parse(sab.deadline) - Date.now()) / 1000));
    if (sab.type === 'REACTOR') {
      banner.textContent = `\u26A0\uFE0F REACTOR MELTDOWN \u2014 2 Crewmates m\u00fcssen zusammen im Reactor fixen! ${remaining}s`;
    } else {
      const o2 = sab.panels?.o2 ? '\u2705' : '\u274C';
      const admin = sab.panels?.admin ? '\u2705' : '\u274C';
      banner.textContent = `\u26A0\uFE0F Sauerstoff! Fix in O2 ${o2} + Admin ${admin} \u2014 ${remaining}s`;
    }
    banner.classList.remove('hidden');
    banner.classList.toggle('reactor-war', sab.type === 'REACTOR');
    banner.classList.toggle('o2-war', sab.type === 'O2');
  }
  setInterval(renderSabotage, 1000);

  // ------------------------------------------------------------ gps loop //

  /** GPS->Meter Projektion auf Basis des gespeicherten Karten-Ankers. */
  function projectorFor(key = null) {
    if (key) return key === state.projKey ? state.proj : null;
    const anchor = state.room?.map?.anchor;
    if (!anchor || typeof anchor.lat !== 'number') return null;
    const cacheKey = `${anchor.lat}:${anchor.lon}`;
    if (state.projKey !== cacheKey) {
      state.projKey = cacheKey;
      state.proj = OSM.createProjector(anchor.lat, anchor.lon);
    }
    return state.proj;
  }

  ensureGpsLoop.started = false;
  function ensureGpsLoop() {
    if (!('geolocation' in navigator) || ensureGpsLoop.started) return;
    ensureGpsLoop.started = true;
    navigator.geolocation.watchPosition((pos) => {
      state.gpsFix = pos.coords;
      state.gpsFixAt = Date.now();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
  }

  function stopGpsLoop() {
    // Watcher bleibt billig aktiv; der Sendetakt prüft den Status selbst.
    state.nearbyBodies = [];
  }

  setInterval(() => {
    const room = state.room;
    if (!room || room.status !== 'IN_GAME' || !state.gpsFixAt) return;
    if (Date.now() - state.gpsFixAt > 10000) return;
    const proj = projectorFor();
    if (!proj) return;
    const [x, y] = proj.project(state.gpsFix.latitude, state.gpsFix.longitude);
    const confidence = Math.min(1, Math.max(0, (60 - (state.gpsFix.accuracy ?? 60)) / 60));
    emitPosition({ x, y, confidence });
  }, 2000);

  function emitPosition({ x, y, confidence }) {
    const last = state.lastSent;
    if (last && Date.now() - last.at < 1000) return;
    state.lastSent = { at: Date.now() };
    const socket = ensureSocket();
    socket.emit('position:update', {
      code: state.code,
      x,
      y,
      confidence,
      source: 'GPS',
    });
  }

  // --------------------------------------------------------- live map draw //

  function drawGameMap() {
    const canvas = $('game-map');
    const map = state.room?.map;
    if (!canvas || !map?.nodes?.length) return;
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth * 2;
    canvas.height = wrap.clientHeight * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const nodes = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
    const pts = [...map.nodes.map((n) => [n.x, n.y])];
    if (state.selfPos) pts.push([state.selfPos.x, state.selfPos.y]);
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const w = maxX - minX || 50;
    const h = maxY - minY || 50;
    const pad = 20;
    const scale = Math.min((canvas.width / 2 - pad * 2) / w, (canvas.height / 2 - pad * 2) / h);
    const toPx = (x, y) => [
      pad + (x - minX) * scale,
      pad + (y - minY) * scale,
    ];

    // corridors: server format is { id, a, b } between two nodes
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3a3f55';
    for (const c of map.corridors ?? []) {
      const from = nodes[c.a];
      const to = nodes[c.b];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(...toPx(from.x, from.y));
      ctx.lineTo(...toPx(to.x, to.y));
      ctx.stroke();
    }

    // rooms polygons
    ctx.lineWidth = 2;
    for (const r of map.rooms ?? []) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      ctx.strokeStyle = r.type === 'MEETING' ? 'rgba(74,222,128,0.7)' : 'rgba(255,209,102,0.55)';
      ctx.fillStyle = 'rgba(255, 209, 102, 0.07)';
      ctx.beginPath();
      poly.forEach((pt, i) => {
        const [px, py] = toPx(pt.x, pt.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      if (r.name) {
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(r.name, ...toPx(cx, cy));
      }
    }

    // task markers: echte Server-Koordinaten (roomId/roomName/x/y);
    // \u00e4ltere Runden ohne Spots fallen auf Karten-Knoten zur\u00fcck.
    let taskIdx = 0;
    for (const task of state.role?.tasks ?? []) {
      if (task.completed) continue;
      let tx, ty;
      if (task.x != null) {
        [tx, ty] = toPx(task.x, task.y);
      } else {
        const waypoints = [];
        for (const corridor of map.corridors ?? []) {
          const aNode = nodes[corridor.a];
          const bNode = nodes[corridor.b];
          if (aNode) waypoints.push(aNode);
          if (bNode) waypoints.push(bNode);
        }
        if (!waypoints.length && map.nodes.length) waypoints.push(map.nodes[0]);
        if (!waypoints.length) break;
        const wedge = waypoints[(taskIdx * 7) % waypoints.length];
        [tx, ty] = toPx(wedge.x + (taskIdx % 3) * 6, wedge.y);
      }
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(tx, ty, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c1204';
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(String(taskIdx + 1), tx, ty + 4);
      ctx.textAlign = 'left';
      taskIdx += 1;
    }

    // corpses the player has discovered
    for (const body of state.nearbyBodies ?? []) {
      const [bx, by] = toPx(body.x, body.y);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // self marker
    if (state.selfPos) {
      const [sx, sy] = toPx(state.selfPos.x, state.selfPos.y);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(74,222,128,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, state.selfPos.onRoom || state.selfPos.onCorridor ? 14 : 20, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  window.addEventListener('resize', () => drawGameMap());
  window.addEventListener('orientationchange', () => setTimeout(drawGameMap, 300));

  /** Landscape: lock wenn unterstützt (Android), sonst iOS-Dreh-Hinweis via CSS. */
  function renderPhaseHint(room) {
    if (!state.role) return;
    const aliveCount = room.players.filter((p) => p.isAlive).length;
    $('game-phase-hint').textContent = room.status === 'MEETING'
      ? 'Meeting l\u00e4uft'
      : `Lebende Spieler: ${aliveCount}`;
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
      position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
      maxWidth: '88vw', padding: '10px 16px', borderRadius: '10px',
      background: 'rgba(30, 30, 38, 0.95)', color: '#fff',
      fontSize: '14px', zIndex: '999',
      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.4)',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  $('btn-report').addEventListener('click', () => {
    if (state.room?.status === 'MEETING') return;
    ensureSocket().emit('game:report', { code: state.code });
    vibrate([80]);
  });

  $('btn-kill').addEventListener('click', () => {
    const targets = state.killTargets ?? [];
    if (!targets.length) {
      showToast('Kein Opfer in Reichweite \u2014 geh n\u00e4her ran!');
      return;
    }
    if (Date.now() < state.killReadyAt) {
      showToast(`Kill bereit in ${Math.ceil((state.killReadyAt - Date.now()) / 1000)}s`);
      return;
    }
    // Nearest victim wins: no extra pick dialog needed.
    ensureSocket().emit('game:kill', { code: state.code, targetPlayerId: targets[0].playerId });
    $('btn-kill').disabled = true;
    $('btn-kill').textContent = 'Kill';
  });

  $('btn-use').addEventListener('click', () => {
    const action = useAction();
    if (!action) return;
    const socket = ensureSocket();
    if (action.kind === 'FIX') {
      socket.emit('game:sabotage_fix', { code: state.code, panel: action.panel });
      vibrate(60);
    } else if (action.kind === 'TASK') {
      socket.emit('task:complete', { code: state.code, taskId: action.task.id });
      vibrate(60);
    } else if (action.kind === 'EMERGENCY') {
      state._usedEmergency = true;
      socket.emit('game:emergency', { code: state.code });
      vibrate(60);
    }
  });

  $('btn-sabotage').addEventListener('click', () => {
    if (!state.room?.sabotage) {
      ensureSocket().emit('game:sabotage', { code: state.code });
      vibrate(60);
    }
  });

  $('btn-game-leave').addEventListener('click', () => {
    state.role = null;
    state.teammates = [];
    state.socket?.disconnect();
    state.socket = null;
    state.room = null;
    localStorage.removeItem('rlaus_session');
    show('home');
  });
  $('btn-rematch').addEventListener('click', () => {
    ensureSocket().emit('game:reset', { code: state.code });
    hideOverlaysNot();
    show('lobby');
  });

  // ------------------------------------------------------------- meeting //

  function renderMeeting({ phase, reporterId, discussionDeadline }) {
    $('gameover-overlay').classList.add('hidden');
    $('meeting-overlay').classList.remove('hidden');
    $('meeting-title').textContent = phase === 'DISCUSSION' ? 'Notfall-Meeting' : 'Abstimmung';
    $('meeting-hint').textContent =
      reporterId === state.playerId
        ? 'Du hast gemeldet! Diskutieren\u2026'
        : `Jemand hat gemeldet \u2014 ${deadlineText(discussionDeadline)}`;
    const players = state.room?.players ?? [];
    openVoteList(
      players.filter((p) => p.isAlive),
      (targetId) => {
        ensureSocket().emit('game:vote_cast', { code: state.code, targetId });
        state.voted = true;
      },
    );
    if (state.voted) $('meeting-hint').textContent = 'Deine Stimme ist drin.';
  }

  function openVoteList(candidates, onPick, title = 'Auf wen abstimmst du?') {
    const list = $('vote-list');
    list.innerHTML = '';
    $('meeting-hint').textContent = title;
    for (const player of candidates) {
      const isMate = (state.teammates ?? []).some((m) => m.id === player.id);
      const li = document.createElement('li');
      li.innerHTML = `<span${isMate ? ' class="imp-name"' : ''}>${escapeHtml(player.name)}</span>`;
      const button = document.createElement('button');
      button.textContent = 'W\u00e4hlen';
      button.className = 'secondary small';
      button.addEventListener('click', () => {
        list.innerHTML = '';
        $('meeting-hint').textContent = 'Stimme abgegeben \u2014 warte auf die anderen\u2026';
        onPick(player.id);
      });
      li.appendChild(button);
      list.appendChild(li);
    }
    const skip = document.createElement('button');
    skip.textContent = '\u00dcberspringen';
    skip.style.width = '100%';
    skip.addEventListener('click', () => {
      ensureSocket().emit('game:vote_cast', { code: state.code, skip: true });
      state.voted = true;
      list.innerHTML = '';
      $('meeting-hint').textContent = 'Stimme abgegeben \u2014 warte auf die anderen\u2026';
    });
    list.appendChild(skip);
  }

  // ------------------------------------------------------------ bootstrap //

  // Service-Worker for offline install (only on secure origins).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Auto-rejoin seamlessly on page reload (e.g. app restart for PWA).
  if (localStorage.getItem('rlaus_session')) {
    ensureSocket();
    ensureSocket().once('connect', () => tryRejoin());
  }

  return {
    screens,
    show,
    ensureSocket,
    getState: () => state,
  };
})();

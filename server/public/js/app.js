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
      // MAP_READY: the host may go back to the lobby and start the game.
      const startGame = $('btn-start-game');
      startGame.disabled = !(room.status === 'MAP_READY' && state.isHost);
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
      if (!screens.home.classList.contains('active')) {
        alert(`Server: ${message ?? 'Unbekannter Fehler'}`);
      } else {
        errorHome(message ?? 'Aktion fehlgeschlagen.');
      }
    });
    socket.onAny((event) => console.debug('[socket]', event));

    socket.on('game:started', () => {
      show('game');
      beep(520);
    });
    socket.on('game:role_assigned', (payload) => {
      state.role = payload;
      state.killReadyAt = payload.killReadyAt ?? 0;
      renderRole(payload);
      vibrate([40]);
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
      if (status === 'GAME_OVER') hideOverlaysNot();
    });
    socket.on('game:over', ({ winner, players }) => {
      $('gameover-overlay').classList.remove('hidden');
      $('gameover-title').textContent =
        winner === 'CREWMATE' ? 'Crewmates haben gewonnen!' : 'Impostoren haben gewonnen!';
      const alivePlayers = (players ?? []).filter((p) => p.isAlive).map((p) => p.name);
      $('gameover-detail').textContent = `Am Ende \u00fcbrig: ${alivePlayers.join(', ')}`;
      $('btn-rematch').classList.toggle('hidden', !state.isHost);
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
    $('lobby-waiting').classList.toggle('hidden', isHost);
    $('lobby-code').textContent = room.code;
    renderLobbyPlayers(room);
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
      li.innerHTML = `<span>${escapeHtml(player.name)}${player.isBot ? ' \u{1F916}' : ''}</span><span class="badge">${badge}</span>`;
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
        rooms: [],
        connections: [],
      },
    });
    const nodeCount = working.nodes.length;
    const corridorCount = working.corridors.length;
    $('map-status').textContent = `${nodeCount} Knoten, ${corridorCount} Verbindungen \u2014 weiter antippen oder speichern`;
    editor.selected.clear();
    $('btn-build-streets').disabled = true;
  });

  $('btn-map-save').addEventListener('click', () => {
    const working = editor.working;
    if (!working.nodes.length) {
      $('map-status').textContent = 'Map ist leer \u2014 erst Stra\u00DFen laden und \u00fcbernehmen.';
      return;
    }
    ensureSocket().emit('map:save', {
      code: state.code,
      map: { ...working, rooms: [], connections: [] },
    });
    alert('Karte gespeichert! Zur\u00fcck in die Lobby \u2014 dann Spiel starten.');
    show('lobby');
  });

  $('btn-map-clear').addEventListener('click', () => {
    if (!confirm('Alle Stra\u00DFen und Knoten l\u00f6schen?')) return;
    editor.clearWorking();
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { version: 1, nodes: [], corridors: [], rooms: [], connections: [] },
    });
    $('map-status').textContent = 'Karte entleert.';
  });

  $('btn-zoom-in').addEventListener('click', () => editor.zoomBy(1.4));
  $('btn-zoom-out').addEventListener('click', () => editor.zoomBy(1 / 1.4));
  $('map-radius').addEventListener('change', () => {});

  // ---------------------------------------------------------------- game //

  function renderRole(payload) {
    const banner = $('role-banner');
    const impostor = payload.role === 'IMPOSTOR';
    banner.textContent = impostor ? 'DU BIST IMPOSTOR' : 'DU BIST CREWMATE';
    banner.className = impostor ? 'role-impostor' : 'role-crew';
    $('btn-kill').classList.toggle('hidden', !impostor);
    vibrate([60, 40, 60]);

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
        beep(880);
        vibrate(30);
      });
      li.appendChild(button);
      list.appendChild(li);
    }
    if (!payload.tasks?.length) {
      list.innerHTML = '<li><span>Keine Tasks \u2014 als Impostor sabotier, als Geist beobachte.</span></li>';
    }
  }

  function renderPhaseHint(room) {
    if (!state.role) return;
    const aliveCount = room.players.filter((p) => p.isAlive).length;
    $('game-phase-hint').textContent = room.status === 'MEETING'
      ? 'Meeting l\u00e4uft'
      : `Lebende Spieler: ${aliveCount}`;
  }

  $('btn-report').addEventListener('click', () => {
    if (state.room?.status === 'MEETING') return;
    ensureSocket().emit('game:report', { code: state.code });
    vibrate([80]);
  });

  $('btn-kill').addEventListener('click', () => {
    if (Date.now() < state.killReadyAt) {
      alert(`Kill bereit in ${Math.ceil((state.killReadyAt - Date.now()) / 1000)}s`);
      return;
    }
    const targets = (state.room?.players ?? []).filter(
      (p) => p.isAlive && p.id !== state.playerId,
    );
    if (!targets.length) return;
    // Simple pick from the nearest list — proximité gate comes later.
    openVoteList(targets, (targetId) => {
      ensureSocket().emit('game:kill', { code: state.code, targetPlayerId: targetId });
    }, 'Wen killst du?');
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
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(player.name)}</span>`;
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

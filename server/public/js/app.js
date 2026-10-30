/**
 * PWA app shell: start screen, lobby, map editor and the in-game HUD.
 * All server interaction runs through Socket.IO with the same event
 * protocol as the Flutter client. UI language: German.
 */
'use strict';

const App = (() => {
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------- i18n (DE/EN) //
  const I18N = {
    de: {
      // Rollen-Karte
      'role.crew.title': 'CREWMATE',
      'role.crew.line1': 'Erledige alle Tasks',
      'role.crew.and': 'und finde den Impostor!',
      'role.imp.title': 'IMPOSTOR',
      'role.imp.line1': 'Sabotiere und töte heimlich.',
      'role.tap': 'Tippe zum Fortfahren',
      'game.partner': 'Partner',
      'banner.crew': 'DU BIST CREWMATE',
      'banner.imp': 'DU BIST IMPOSTOR',
      // Spielstatus
      'phase.prepare': 'Lobby',
      'phase.in_game': 'Runde läuft',
      'phase.meeting': 'Meeting',
      'phase.game_over': 'Spiel vorbei',
      // Buttons
      'btn.report': 'Report',
      'btn.use': 'Use',
      'btn.sabotage': 'Sabotage',
      'btn.kill': 'Kill',
      'btn.leave': 'Runde verlassen',
      'settings.title': 'Einstellungen',
      'settings.sound': 'Sounds & Klingeltöne',
      'settings.vibration': 'Vibration',
      'settings.bots': 'Bot-Positionen anzeigen',
      'settings.lang': 'Sprache',
      'settings.note': 'Verlassen beendet die Verbindung. Die Lobby läuft weiter.',
      // GPS / Karte
      'gps.denied': 'Standort ist blockiert! Erlaube GPS für diese Seite (Browser-Einstellungen), sonst siehst du dich nicht.',
      'gps.unavailable': 'Kein GPS-Empfang — geh nach draußen oder warte.',
      'gps.waiting': 'Warte auf GPS-Signal …',
      'gps.lost': 'GPS-Signal verloren …',
      'gps.noapi': 'Dein Browser kennt keinen Standort (GPS) — du siehst deinen Marker nicht.',
      'gps.noanchor': 'Karte noch nicht kalibriert: \u2699\ufe0e Zahnrad \u2192 „Karte kalibrieren“ \u2014 2 Stra\u00dfenecken abgehen (einmalig, gilt f\u00fcr immer).',
      'map.waiting': 'Warte auf GPS …',
      'map.you': 'DU',
      'map.noTasks': 'Aktiv gerade keine Task',
      // Tasks
      'tasks.summary': 'Deine Tasks',
      'comms.down': 'Kommunikation gest\u00f6rt \u2014 keine Taskdaten!',
      'tasks.done': 'erledigt',
      'tasks.stage': 'Stufe',
      'tasks.next': 'Danach',
      'tasks.open': 'Tippe auf den Marker auf der Karte',
      // Meeting
      'meeting.title': 'Notfall-Meeting',
      'meeting.voteTitle': 'Abstimmung',
      'meeting.vote': 'Auf wen stimmst du?',
      'meeting.skip': 'Überspringen',
      'meeting.count': 'Abstimmen:',
      // Gameover
      'over.title': 'Spiel vorbei',
      // Toasts
      'toast.outside': 'Du bist außerhalb des Spielfelds! Komm zurück, sonst zählt die Runde nicht.',
      'toast.taskdone': 'Task erledigt!',
      'toast.stageNext': 'Nächster Stufenort:',
      'toast.taskNear': 'Task-Marker in Reichweite',
      'toast.noMoveYet': 'Beweg dich erst, dann kannst du reporten.',
      'game.out': 'Du bist raus',
      'game.ejected': 'wurde rausgewählt.',
      'eject.was': '{name} wurde rausgeworfen.',
      'eject.wasImp': '{name} war ein Impostor.',
      'eject.wasNotImp': '{name} war kein Impostor.',
      'eject.remain': '{n} Impostor(s) übrig.',
      'game.ejectedSkip': 'Niemand wurde rausgewählt (Skip).',
      'map.back': 'Geh zurück aufs Spielfeld!',
      'map.warning': 'Warnung',
      'map.adminOut': 'ist so weit draußen:',
      'game.youKilled': 'Du wurdest eliminiert! Beobachte weiter — Report geht als Geist.',
      'game.someoneKilled': 'Jemand wurde eliminiert. Halte die Augen offen!',
      'game.alive': 'Lebende Spieler:',
      'game.someoneKilled': 'Jemand wurde eliminiert. Halte die Augen offen!',
      'sab.reactor': '2 Crewmates müssen zusammen im Reactor fixen!',
      'sab.o2': 'Sauerstoff! Fix in O2',
      'sab.lights': 'Lichter aus — Leichen werden nicht gefunden. Fix in ELECTRICAL!',
      'sab.comms': 'COMMS gestört — Taskliste deaktiviert. Fix in COMMUNICATIONS!',
    },
    en: {
      'role.crew.title': 'CREWMATE',
      'role.crew.line1': 'Complete all your tasks',
      'role.crew.and': 'and find the impostor!',
      'role.imp.title': 'IMPOSTOR',
      'role.imp.line1': 'Sabotage and kill secretly.',
      'role.tap': 'Tap to continue',
      'game.partner': 'Partner',
      'banner.crew': 'YOU ARE A CREWMATE',
      'banner.imp': 'YOU ARE THE IMPOSTOR',
      'phase.prepare': 'Lobby',
      'phase.in_game': 'Round in progress',
      'phase.meeting': 'Meeting',
      'phase.game_over': 'Game over',
      'btn.report': 'Report',
      'btn.use': 'Use',
      'btn.sabotage': 'Sabotage',
      'btn.kill': 'Kill',
      'btn.leave': 'Leave round',
      'settings.title': 'Settings',
      'settings.sound': 'Sounds & ringtones',
      'settings.vibration': 'Vibration',
      'settings.bots': 'Show bot positions',
      'settings.lang': 'Language',
      'settings.note': 'Leaving ends your connection. The lobby keeps running.',
      'gps.denied': 'Location is blocked! Allow GPS for this page (browser settings), otherwise you will not see yourself.',
      'gps.unavailable': 'No GPS reception — go outside or wait.',
      'gps.waiting': 'Waiting for GPS signal …',
      'gps.lost': 'GPS signal lost …',
      'gps.noapi': 'Your browser has no location support — you will not see your marker.',
      'gps.noanchor': 'Map not calibrated yet: \u2699\ufe0e gear \u2192 "Calibrate map" \u2014 visit 2 clear points (one time, stored forever).',
      'map.waiting': 'Waiting for GPS …',
      'map.you': 'YOU',
      'map.noTasks': 'No active task right now',
      'tasks.summary': 'Your tasks',
      'comms.down': 'Communications sabotaged \u2014 no task data!',
      'tasks.done': 'completed',
      'tasks.stage': 'Stage',
      'tasks.next': 'Next',
      'tasks.open': 'Tap the marker on the map',
      'meeting.title': 'Emergency meeting',
      'meeting.voteTitle': 'Vote',
      'meeting.vote': 'Who do you vote for?',
      'meeting.skip': 'Skip vote',
      'meeting.count': 'Voting:',
      'over.title': 'Game over',
      'toast.outside': 'You are outside the play area! Come back or the round will not count.',
      'toast.taskdone': 'Task completed!',
      'toast.stageNext': 'Next stage location:',
      'toast.taskNear': 'Task marker within range',
      'toast.noMoveYet': 'Move first before you can report.',
      'game.out': 'You are out',
      'game.ejected': 'was voted out.',
      'eject.was': '{name} was ejected.',
      'eject.wasImp': '{name} was An Impostor.',
      'eject.wasNotImp': '{name} was not An Impostor.',
      'eject.remain': '{n} Impostor{s} remain.',
      'game.ejectedSkip': 'Nobody was voted out (skipped).',
      'map.back': 'Back to the play area!',
      'map.warning': 'Warning',
      'map.adminOut': 'is this far outside:',
      'game.youKilled': 'You were eliminated! Keep watching — you can report as a ghost.',
      'game.someoneKilled': 'Someone was eliminated. Keep your eyes open!',
      'game.alive': 'Players alive:',
      'game.someoneKilled': 'Someone was eliminated. Keep your eyes open!',
      'sab.reactor': '2 crewmates must fix it together in the reactor!',
      'sab.o2': 'Oxygen! Fix at O2',
      'sab.lights': 'Lights out — bodies will not be found. Fix in ELECTRICAL!',
      'sab.comms': 'COMMS sabotaged — task list disabled. Fix in COMMUNICATIONS!',
    },
  };

  function langActive() {
    return localStorage.getItem('rlaus_lang') === 'en' ? 'en' : 'de';
  }
  /** Übersetzung: fehlt ein Key, fällt EN auf DE zurück (nie leeres UI). */
  function t(key) {
    return I18N[langActive()][key] ?? I18N.de[key] ?? key;
  }
  /** Statische Texte im HTML tauschen (data-i18n Attribute). */
  function applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
  }
  function setLang(lang) {
    localStorage.setItem('rlaus_lang', lang === 'en' ? 'en' : 'de');
    applyStaticI18n();
    renderGameHud();
    drawGameMap();
  }
  applyStaticI18n();

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

  // Among-Us-Farbpalette (Spiegel von server PLAYER_COLORS).
  const PLAYER_COLOR_HEX = {
    red: '#C51111', blue: '#132ED1', green: '#117F2D', pink: '#ED54BA',
    orange: '#EF7D0D', yellow: '#F5F557', black: '#3F474E', white: '#D6E0F0',
    purple: '#6B2FBB', brown: '#71491E', cyan: '#38FEDC', lime: '#50EF39',
    maroon: '#6B2B3C', rose: '#ECC0D3', banana: '#F0F0A8', gray: '#8397A7',
    tan: '#91897F', coral: '#EC7578',
  };
  function colorChipHex(colorId) {
    return PLAYER_COLOR_HEX[colorId ?? 'gray'] ?? '#8397A7';
  }

  const editor = new MapEditor($('map-canvas'), {
    onSelectionChanged: (count) => {
      $('btn-build-streets').disabled = count === 0;
      $('map-status').textContent = `${count} Abschnitte ausgew\u00E4hlt`;
    },
    onRoomsChanged: (removed) => {
      // Rooms geaendert: direkt an den Server spiegeln (Lobby-Update folgt).
      ensureSocket().emit('map:update', {
        code: state.code,
        map: { ...editor.working, rooms: editor.rooms, connections: [] },
      });
      showToast(`Raum "${removed?.name ?? '?'}" gel\u00f6scht (${editor.rooms.length} übrig).`);
      beep(300);
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
    if (!optEnabled('rlaus_vibration', true)) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  /** Einstellungen aus dem Gear-Men\u00fc (persistiert in localStorage). */
  function optEnabled(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === '1';
  }
  function showBotsEnabled() {
    return optEnabled('rlaus_showBots', true);
  }

  /**
   * Sichtig-Fehler-Chip: Jeder unbehandelte JS-Fehler wird als roter Chip
   * oben angezeigt (statt unsichtbar im Handy-Konsole-Log zu verschwinden).
   * Nach 15s verschwindet er von selbst — IRL-Debug w/o Laptop.
   */
  /* ---------------------------------------------------- error diary --
   * Alles Fehler laufen in ein Telefon-Log (localStorage): JS-Crashe,
   * Server-Abweisungen (z.B. "Karte ist gesperrt"), GPS-Irrtümer.
   * Der Superuser (Diraj/Divo) kann es im Zahnrad-Menü kopieren und
   * schicken — kein Laptop-Kabel mehr nötig.
   */
  const ERROR_LOG_KEY = 'rlaus_errorlog.v1';
  const ERROR_LOG_MAX = 50;

  function logAppError(kind, message, stack = '') {
    // ResizeObserver-Loop = Browser-Randnotiz (Layout ok, kein Bug).
    if (/ResizeObserver loop/i.test(String(message))) return;
    try {
      const log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]');
      log.push({
        at: new Date().toLocaleTimeString('de-DE'),
        kind,
        message: String(message).slice(0, 220),
        ...(stack ? { stack: String(stack).slice(0, 200) } : {}),
      });
      while (log.length > ERROR_LOG_MAX) log.shift();
      localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log));
    } catch (_) { /* log best-effort */ }
  }

  function renderErrorLogBox() {
    const box = $('error-log-box');
    if (!box) return;
    let log = [];
    try { log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]'); } catch (_) {}
    const header = [
      `RLAUS Log (${log.length}) — ${new Date().toLocaleString('de-DE')}`,
      `Spieler: ${state.name || '?'} | Code: ${state.code || '—'}`,
      '---',
    ];
    box.value = header.concat(log.map(
      (entry) => `[${entry.at}] ${entry.kind}: ${entry.message}`,
    )).join('\n');
  }

  function showErrorLogUi() {
    const isSuperuser = ['Diraj', 'Divo'].includes(state.name);
    $('dev-errorbox').classList.toggle('hidden', !isSuperuser);
    if (isSuperuser) renderErrorLogBox();
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#btn-error-copy')) {
      const box = $('error-log-box');
      box.select();
      const done = () => showToast('Fehler-Log kopiert! Einfach an Divo schicken.');
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(box.value).then(done).catch(() => {
          document.execCommand('copy');
          done();
        });
      } else {
        document.execCommand('copy');
        done();
      }
    } else if (event.target.closest('#btn-error-clear')) {
      localStorage.removeItem(ERROR_LOG_KEY);
      renderErrorLogBox();
      showToast('Fehler-Log gelöscht.');
    }
  });

  function showJsError(error) {
    try {
      let chip = document.getElementById('js-error-chip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'js-error-chip';
        chip.addEventListener('click', () => chip.classList.add('hidden'));
        document.body.appendChild(chip);
      }
      const stackLine = String(error?.stack ?? '').split('\n')
        .filter((line) => /app\.js|tasks\.js|mapEditor\.js|osm\.js/.test(line))
        .map((line) => line.trim())
        .filter(Boolean)[0];
      chip.textContent = `App-Fehler: ${(error?.message ?? String(error)).slice(0, 110)}` +
        (stackLine ? ` @ ${stackLine.slice(-100)}` : '');
      chip.classList.remove('hidden');
      window.clearTimeout(showJsError._t);
      showJsError._t = window.setTimeout(() => chip.classList.add('hidden'), 15000);
    } catch (_) { /* chip is best-effort */ }
  }
  window.addEventListener('error', (event) => {
    showJsError(event.error ?? event.message);
    logAppError('js', event.message, event.error?.stack ?? '');
  });
  window.addEventListener('unhandledrejection', (event) => {
    showJsError(event.reason);
    logAppError('promise', String(event.reason?.message ?? event.reason),
      event.reason?.stack ?? '');
  });

  function beep(freq = 660, durationMs = 140) {
    if (!optEnabled('rlaus_sound', true)) return;
    try {
      if (!App.audioCtx) App.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = App.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.value = 0.15 * sfxVolumeBase();
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (_) { /* audio not available */ }
  }

  /* -------------------------------------------------------- sfx ---
   * Originales Sound-Paket aus dem Spiel verwendet die WAVs im Ordner
   * /sfx/ (aus den 4 Zips kuratiert). Ausgabe nur wenn Sound an ist,
   * Fehler schweigen (Sound ist Zuckerguss, kein Critical Path).
   * Erste Berührung "entriegelt" die Mitte (iOS-Autoplay-Regel).
   */
  const sfxCache = {};
  function sfxVolumeBase() {
    const raw = Number(localStorage.getItem('rlaus_sfx_vol'));
    return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.8;
  }
  function sfx(name, volume = 1) {
    if (!optEnabled('rlaus_sound', true)) return;
    const effective = sfxVolumeBase() * Math.max(0, volume);
    if (effective <= 0) return;
    try {
      let a = sfxCache[name];
      if (!a) {
        a = sfxCache[name] = new Audio(`/sfx/${name}.wav`);
        a.preload = 'auto';
      }
      a.volume = Math.min(1, effective);
      a.currentTime = 0;
      a.play().catch(() => {});
    } catch (_) { /* sound best-effort */ }
  }
  const sfxUnlocked = { done: false };
  document.addEventListener('touchend', () => {
    if (sfxUnlocked.done) return;
    sfxUnlocked.done = true;
    try {
      const a = new Audio('/sfx/task_open.wav');
      a.volume = 0;
      a.play().then(() => a.pause()).catch(() => {});
    } catch (_) { /* unlock best-effort */ }
  }, { once: true, passive: true });
  window.RlausSfx = sfx;

  // Menue/Lobby-Sound: JEDER Button-Druck gibt ein kurzes UI-Klick-Geräusch.
  document.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('button')) sfx('ui_select', 0.5);
  }, true);

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
      tryRestoreAnchor(room);
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
            map: {
              version: cached.version + 1, nodes: cached.nodes,
              corridors: cached.corridors, rooms: cached.rooms ?? [],
              connections: [],
            },
          });
          ensureSocket().emit('map:save', {
            code: state.code,
            map: {
              version: cached.version + 2, nodes: cached.nodes,
              corridors: cached.corridors, rooms: cached.rooms ?? [],
              connections: [],
            },
          });
          showToast('Gespeicherte Karte \u00fcbernommen.');
        } else {
          showToast('Keine gespeicherte Karte auf dem Ger\u00e4t \u2014 Stra\u00dfen laden.');
        }
      } else if (room.status === 'MAP_SETUP' && state.autoCachedMap) {
        // Cache-only-Fall (kein Server-Map): NACH dem MAP_SETUP-ACK laden,
        // damit das map:update erlaubt ist. Später NIE mehr zurückspulen —
        // das verursachte das Millisekunden-Flash beim Zeichnen.
        applyCachedMap();
        state.autoCachedMap = false;
      }
      if (room.status === 'MAP_READY' && active === 'screen-map') {
        show('lobby');
      }
      // Server = Quelle der Wahrheit fürs Editor-Typraster (ein Raum pro
      // Sorte, Duplikate entfallen serverseitig). Überschreibt NICHTs
      // während des Zeichnens: nur bei echtem Unterschied ersetzen.
      if (room.status === 'MAP_SETUP' && active === 'screen-map') {
        syncRoomEditorFromServer(room);
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
    socket.on('room:error', ({ code: errorCode, message, details }) => {
      // Server meldet teils englische Fachtexte — unten deutsche Klartexte.
      logAppError('server', `${errorCode}: ${message ?? ''}`);
      if (errorCode === 'AUTH_FAILED') {
        // Session abgelaufen (z. B. Server-Restart): sauber raus statt
        // Position-Spam; GPS aus, Lobby zeigen.
        stopGpsLoop();
        state.room = null;
        state.selfPos = null;
        showToast('Sitzung abgelaufen \u2014 bitte mit dem Code neu beitreten.');
      }
      if (errorCode === 'NOT_IN_ROOM') {
        // Verlorene Session (AUTH/Reconnect): raus aus dem Spiel, GPS-Stop.
        stopGpsLoop();
        state.room = null;
        state.selfPos = null;
      }
      if (errorCode === 'MAP_CRITICAL_ROOMS_MISSING') {
        const missing = Array.isArray(details?.missing) ? details.missing : [];
        showToast(`Der Karte fehlen noch R\u00e4ume: ${missing.length ? missing.join(', ') : 'kritische R\u00e4ume'} \u2014 bitte noch zeichnen.`);
        return;
      }
      const friendly = {
        MAP_LOCKED: 'Karte kann nicht ge\u00e4ndert werden \u2014 falls die Runde l\u00e4uft gilt der alte Stand.',
        MAP_MISSING: 'Keine Karte im Spiel \u2014 Host muss erst eine speichern.',
        MAP_ANCHOR_INVALID: 'Der Setz-Punkt war ung\u00fcltig \u2014 nochmal mit GPS-Signal versuchen.',
        CONFIG_INVALID: 'Eine Regel hatte einen unm\u00f6glichen Wert \u2014 bitte neu einstellen.',
        INVALID_PHASE: 'Das geht in dieser Spielphase nicht.',
        POSITION_NOT_ALLOWED: null, // still \u2014 normal in Meetings
      }[errorCode];
      const text = friendly ?? message ?? 'Aktion fehlgeschlagen.';
      if (text == null) return;
      if (screens.home.classList.contains('active')) {
        errorHome(text);
      } else {
        showToast(text);
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
      if (state.room) {
        state.room.sabotage = {
          type,
          deadline,
          ...(type === 'O2' ? { panels: { o2: false, admin: false } } : {}),
        };
      }
      sfx('sabotage_alarm');
      vibrate([80, 60, 80, 60, 160]);
      renderSabotage();
    });
    socket.on('game:sabotage_fixed', ({ code: _code }) => {
      if (state.room) delete state.room.sabotage;
      $('sabotage-banner').classList.add('hidden');
      sfx('notification');
      renderGameHud();
    });
    socket.on('game:bodies_nearby', ({ bodies }) => {
      state.nearbyBodies = bodies ?? [];
      renderGameHud();
      drawGameMap();
    });
    socket.on('position:confirmed', (pos) => {
      state.selfPos = pos;
      state._posRejectCount = 0;
      state._posHoldUntil = 0;
      state.anchorOk = !!pos.onCorridor || !!pos.onRoom;
      // Zurück im Spielfeld -> Warnbanner ausblenden.
      if (state.selfPos.onCorridor || state.selfPos.onRoom) {
        $('boundary-banner').classList.add('hidden');
      }
      drawGameMap();
      renderGameHud();
    });
    // Bots gibt es nur virtuell \u2014 ihre Wander-Punkte zeigt das Spiel.
    socket.on('game:bot_positions', ({ impostor, positions }) => {
      state.botPositions ??= {};
      state.botPositions[impostor ? 'impostor' : 'crew'] = positions ?? [];
      if (showBotsEnabled()) drawGameMap();
    });
    // Server-/Bot-Toast: "Bot hat Sabotage mitrepariert" u.a.
    socket.on('game:toast', ({ text }) => {
      if (text) showToast(text);
    });
    socket.on('position:error', ({ code, message }) => {
      if (code === 'POSITION_NOT_ALLOWED') return; // Meeting etc. – ruhig ignorieren
      // Jitter-Sturm (Fehler-Tagebuch 28.10): Nach einer Ablehnung senden
      // wir erst nach 3s wieder — gleiches Rezept für alle POSITION_*.
      state._posHoldUntil = Date.now() + 3000;
      state._posRejectStreak = (state._posRejectStreak ?? 0) + 1;
      if (state._posRejectStreak >= 3) {
        // 3x in Folge abgelehnt -> der vergangene Anker ist Soup-Kurs,
        // Neuanker: nächster Fix klatt ohne Vergleich.
        state.posSmooth = null;
        state.lastSentPos = null;
        state._posRejectStreak = 0;
      }
      logAppError('position', `${code}: ${message ?? ''}`);
      $('game-phase-hint').textContent = `Position abgelehnt: ${code}`;
    });
    socket.on('game:boundary_warning', ({ distanceM, limitM, escalationLevel }) => {
      const banner = $('boundary-banner');
      // Divo-Regelwerk: Stufe 1 = Countdown-Frist, Stufe 2 = ohne Frist
      // hart "Kehre sofort zurück!", Stufe 3 = Host wurde gealarmiert.
      banner.classList.toggle('escalate', (escalationLevel ?? 1) >= 2);
      if (escalationLevel >= 2) {
        banner.textContent = `KEHRE SOFORT ZURÜCK! (±${Math.round(distanceM)}m)`;
      } else {
        banner.textContent = `Geh zurück ins Spielfeld! (${Math.round(distanceM)}m > ${Math.round(limitM)}m)`;
      }
      banner.classList.remove('hidden');
      if (Date.now() - (state._bdVibrateAt ?? 0) > 4000) {
        state._bdVibrateAt = Date.now();
        vibrate([60, 40, 60, 40, 120]);
      }
    });
    socket.on('game:boundary_back', ({ playerId }) => {
      if (state.isHost || playerId === state.playerId) {
        $('boundary-banner').classList.add('hidden');
      }
    });
    socket.on('admin:player_out_of_bounds', ({ name, distanceM }) => {
      // Daueralarm (nicht 10s-Toast): Host-Banner bleibt bis game:
      // boundary_back andkommt.
      const banner = $('boundary-banner');
      banner.textContent = `ADMIN: ${name} ist ${Math.round(distanceM)}m draußen und WEIGERT sich!`;
      banner.classList.add('escalate');
      banner.classList.remove('hidden');
      if (Date.now() - (state._adVibrateAt ?? 0) > 4000) {
        state._adVibrateAt = Date.now();
        vibrate([200, 100, 200]);
      }
    });
    socket.on('game:role_assigned', (payload) => {
      state.role = payload;
      state.killReadyAt = payload.killReadyAt ?? 0;
      state.teammates = payload.teammates ?? [];
      sfx('round_start');
      showRoleOverlay(payload);
      ensureGpsLoop();
      vibrate([60, 60, 120]);
    });
    socket.on('game:kill_cooldown', ({ killReadyAt }) => {
      state.killReadyAt = killReadyAt;
    });
    socket.on('game:killed', ({ killedPlayerId }) => {
      sfx('kill');
      vibrate([200, 80, 200]);
      if (killedPlayerId === state.playerId) {
        $('game-phase-hint').textContent = t('game.youKilled');
      } else {
        $('game-phase-hint').textContent = t('game.someoneKilled');
      }
    });
    socket.on('game:meeting_started', (payload) => renderMeeting(payload));
    socket.on('game:voting_started', ({ votingDeadline }) => {
      state.votingDeadline = votingDeadline ?? 0;
      startVoteCountdown(state.votingDeadline);
      $('meeting-title').textContent = t('meeting.voteTitle');
      $('meeting-title').classList.add('pixel-title');
      if (!state.voted) $('meeting-hint').textContent = deadlineText(votingDeadline);
      // 10s-Bedenkklackern wie im Original (arbeitsspeicherfreundlich: 1 Timer).
      window.clearTimeout(state.votingWarnTimer);
      const warnIn = (votingDeadline ?? 0) - 10000 - Date.now();
      if (state.room?.meeting?.phase === 'VOTING' && warnIn > 0 && state.voted !== true) {
        state.votingWarnTimer = window.setTimeout(() => sfx('vote_timer'), warnIn);
      }
    });
    socket.on('game:vote_reveal', ({ votes }) => {
      sfx('panel_close');
      const bar = $('vote-reveal-bar');
      bar.classList.remove('hidden');
      bar.innerHTML = '';
      if (!votes?.length) {
        bar.innerHTML = '<div class="vote-reveal-line">Stimmen bleiben geheim.</div>';
        return;
      }
      const nameOf = new Map((state.room?.players ?? []).map((p) => [p.id, p]));
      for (const v of votes) {
        const line = document.createElement('div');
        line.className = 'vote-reveal-line';
        const voterChip = `<span class="mini-chip" style="background:${colorChipHex(v.voterColorId)}"></span>`;
        const target = v.targetId == null || v.targetId === 'skip'
          ? 'Skip'
          : String(nameOf.get(v.targetId)?.name ?? '?');
        line.innerHTML = `${voterChip} <strong>${escapeHtml(String(v.voterName ?? '?'))}</strong> \u2192 ${escapeHtml(target)}`;
        bar.appendChild(line);
      }
    });
    socket.on('game:vote_progress', ({ votedCount, totalVoters }) => {
      // Eigene Stimme hat schon vote_locked -> nur für fremde klingeln.
      if (Date.now() - (state.myVoteAt ?? 0) > 1500) sfx('vote_cast', 0.6);
      $('meeting-hint').textContent = `${t('meeting.count')} ${votedCount}/${totalVoters}`;
    });
    /** Nach der Eject-Show: Hinweise + GPS je nach Rundenstatus. */
    function applyEjectAftermath(ejectedPlayerId, ejectedPlayerName, status) {
      if (ejectedPlayerId === state.playerId) {
        $('role-banner').textContent = t('game.out');
        vibrate([120, 60, 120]);
      } else if (ejectedPlayerName) {
        $('game-phase-hint').textContent = `${ejectedPlayerName} ${t('game.ejected')}`;
      } else {
        $('game-phase-hint').textContent = t('game.ejectedSkip');
      }
      if (status === 'GAME_OVER') stopGpsLoop();
      else if (status === 'IN_GAME') ensureGpsLoop();
    }

  socket.on('game:meeting_result',
      ({ ejectedPlayerId, ejectedPlayerName, ejectedRole, impostorsRemaining, status }) => {
      state.voted = false;
      const confirmEjects = state.room?.config?.confirmEjects !== false;
      // Eject-Sequenz: Weltraum + Bean im Spielerfarbton + Result-Text.
      const overlay = $('eject-overlay');
      const bean = $('eject-bean');
      const text = $('eject-text');
      const players = state.room?.players ?? [];
      const ejectedColor = colorChipHex(
        players.find((p) => p.id === ejectedPlayerId)?.colorId,
      );
      bean.style.setProperty('--bean-color', ejectedColor);
      // Animation neu starten (remove -> void offsetWidth -> add).
      bean.style.animation = 'none';
      void bean.offsetWidth;
      bean.style.animation = '';
      let ejectLine;
      if (ejectedPlayerId == null) {
        ejectLine = 'Niemand wurde rausgeworfen (Skipped).';
      } else if (!confirmEjects) {
        const en = String(ejectedPlayerName ?? '?');
        ejectLine = t('eject.was').replace('{name}', en);
      } else {
        const en = String(ejectedPlayerName ?? '?');
        const line = ejectedRole === 'IMPOSTOR'
          ? t('eject.wasImp').replace('{name}', en)
          : t('eject.wasNotImp').replace('{name}', en);
        const remain = Number.isInteger(impostorsRemaining)
          ? t('eject.remain')
            .replace('{n}', String(impostorsRemaining))
            .replace('{s}', langActive() === 'en' && impostorsRemaining !== 1 ? 's' : '')
          : '';
        ejectLine = remain ? `${line}<br>${remain}` : line;
      }
      text.innerHTML = ejectLine;
      $('meeting-overlay').classList.add('hidden');
      overlay.classList.remove('hidden');
      sfx('eject_text');
      window.setTimeout(() => sfx('eject_splash'), 2400);
      const showOverMs = 4200;
      window.setTimeout(() => {
        overlay.classList.add('hidden');
        applyEjectAftermath(ejectedPlayerId, ejectedPlayerName, status);
      }, showOverMs);
    });
    socket.on('game:over', ({ winner, players, reason }) => {
      stopGpsLoop();
      sfx(winner === 'CREWMATE' ? 'victory_crew' : 'victory_impostor');
      $('boundary-banner').classList.add('hidden');
      $('gameover-overlay').classList.remove('hidden');
      // Perspektive: Eigenes Team gewonnen -> Victory, sonst Defeat.
      // Farbe wie im Original: Crew-Sieg cyan, Impostor-Sieg rot.
      const myRole = state.role?.role;
      const teamWon = (winner === 'CREWMATE' && myRole === 'CREWMATE')
        || (winner === 'IMPOSTOR' && myRole === 'IMPOSTOR');
      const goTitle = $('gameover-title');
      goTitle.textContent = teamWon ? 'Victory' : 'Defeat';
      goTitle.classList.add('pixel-title', 'gameover-title');
      goTitle.dataset.tone = winner === 'CREWMATE' ? 'crew' : 'imp';
      $('gameover-overlay').querySelector('.card')
        ?.setAttribute('data-win', winner === 'CREWMATE' ? 'crew' : 'imp');
      const reasonText = {
        TASKS_COMPLETE: 'Alle Tasks wurden erledigt.',
        IMPOSTORS_DEAD: 'Kein Impostor mehr am Leben.',
        IMPOSTOR_PARITY: 'Impostor in \u00dcberzahl (h\u00e4tten Crew nicht mehr stoppen k\u00f6nnen).',
        SABOTAGE_EXPIRED: 'Sabotage nicht rechtzeitig gefixt!',
      }[reason];
      const alivePlayers = (players ?? []).filter((p) => p.isAlive).map((p) => p.name);
      $('gameover-detail').textContent =
        `${reasonText ?? ''}${reasonText ? ' ' : ''}Am Ende \u00fcbrig: ${alivePlayers.join(', ')}`;
      $('btn-rematch').classList.toggle('hidden', !state.isHost);
    });
    socket.on('task:progress', ({ completedTaskId, advancedTaskId, stageIndex }) => {
      const ownList = state.role?.tasks ?? state.tasks ?? [];
      if (advancedTaskId) {
        // Stufe am相结合 abgeschlossen: naechste Stufe wird zum Ziel.
        const task = ownList.find((t) => t.id === advancedTaskId);
        if (task) {
          task.stageIndex = stageIndex ?? 1;
          const nextStage = task.stages?.[task.stageIndex];
          if (nextStage) {
            task.roomId = nextStage.roomId;
            task.roomName = nextStage.roomName;
            task.x = nextStage.x;
            task.y = nextStage.y;
          }
          showToast(`Stufe fertig! N\u00e4chster Schritt: ${task.roomName ?? 'unbekannt'}`);
          const li = $('task-list').querySelector(`[data-task-id="${advancedTaskId}"] small`);
          if (li) li.textContent = task.roomName ?? '';
        }
        beep(660);
        vibrate(40);
        drawGameMap();
        renderGameHud();
        return;
      }
      if (!completedTaskId) return;
      if (ownList.some((t) => t.id === completedTaskId)) {
        const task = ownList.find((t) => t.id === completedTaskId);
        if (task) task.completed = true;
        showToast(task?.isFake ? 'Fake-Task abgehakt (kein Fortschritt \u2014 t\u00e4usche weiter!).' : 'Task erledigt!');
        beep(880);
        vibrate(50);
        const li = $('task-list').querySelector(`[data-task-id="${completedTaskId}"]`);
        if (li) li.classList.add('done');
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
    if (!state.room) return;
    if (state.room.status !== 'LOBBY') {
      showToast('Karte bearbeiten geht nur in der Lobby (Runde verlassen oder neu laden).');
      return;
    }
    ensureSocket().emit('map:start', { code: state.code });
    show('map');
    refreshCachedMapButton();
    // Default-Map/Orriginal SOFORT ins Editor-UI (Divo: schneller Start):
    // vom aktuellen Room-Snapshot, sonst aus dem Gerät-Cache.
    const roomMap = state.room?.map;
    if (roomMap?.nodes?.length) {
      editor.setWorking({ version: roomMap.version ?? 1, nodes: roomMap.nodes, corridors: roomMap.corridors });
      editor.setRooms(roomMap.rooms ?? []);
      if (Number.isFinite(roomMap.anchor?.lat)) editor.setAnchor(roomMap.anchor.lat, roomMap.anchor.lon);
      state.autoCachedMap = false;
      $('map-status').textContent = `Karte geladen (${roomMap.nodes.length} Knoten) \u2014 erweitern oder speichern`;
    } else {
      editor.setRooms(state.room?.map?.rooms ?? []);
      // Cache-only: nach MAP_SETUP-ACK reinladen (map:update braucht den Status).
      state.autoCachedMap = !!readSavedLocalMap()?.nodes?.length;
      $('map-status').textContent = state.autoCachedMap ? 'Lade gespeicherte Karte\u2026' : 'Position suchen\u2026';
    }
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
    // Einer pro Sorte (Divo): alte Duplikate aus dem Cache raus, sonst
    // streicht sie der Server und der Broadcast w\u00e4scht die R\u00e4ume weg.
    const keptTypes = new Set();
    const cachedRooms = (cached.rooms ?? []).filter((room) => {
      if (room.type === 'NORMAL') return true;
      if (keptTypes.has(room.type)) return false;
      keptTypes.add(room.type);
      return true;
    });
    if (cachedRooms.length !== (cached.rooms ?? []).length) {
      window.setTimeout(() => showToast(
        `Duplikate bereinigt: ${cachedRooms.length} von ${(cached.rooms ?? []).length} R\u00e4umen \u00fcbrig (1 pro Sorte).`,
      ), 100);
    }
    const working = {
      version: cached.version + 1,
      nodes: cached.nodes,
      corridors: cached.corridors,
    };
    editor.setWorking(working);
    editor.setRooms(cachedRooms);
    editor.selected.clear();
    $('btn-build-streets').disabled = true;
    ensureSocket().emit('map:update', {
      code: state.code,
      // KRITISCH: rooms MITRAUMEN — fr\u00fcher stand hier rooms: [] und der
      // Server l\u00f6schte alle R\u00e4ume (Millisekunden-Flash!).
      map: { ...working, rooms: editor.rooms, connections: [] },
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

  // Divo-Regel: Räume heißen IMMER genau wie ihr Typ — kein Umbenennen.
  // Typ wird VOR dem Zeichnen gewählt (Typ-Grid); schließt man das
  // Polygon, wird der Raum SOFORT angelegt — nichts eskaliert zu Cafeteria.
  const ROOM_NAME_BY_TYPE = {
    CAFETERIA: 'Cafeteria',
    MEDBAY: 'Medbay',
    SECURITY: 'Security',
    REACTOR: 'Reactor',
    ELECTRICAL: 'Electrical',
    STORAGE: 'Storage',
    ADMIN: 'Admin',
    O2: 'O2',
    WEAPONS: 'Weapons',
  };
  state.editorRoomType ??= 'CAFETERIA';

  function highlightRoomType() {
    document.querySelectorAll('#room-type-grid button').forEach((btn) => {
      btn.classList.toggle('primary',
        !btn.disabled && btn.dataset.roomType === state.editorRoomType);
    });
  }

  function syncRoomEditorFromServer(room) {
    const serverRooms = room.map?.rooms ?? [];
    const sKey = JSON.stringify(serverRooms.map((r) => [r.id, r.name]));
    const eKey = JSON.stringify(editor.rooms.map((r) => [r.id, r.name]));
    if (sKey === eKey) {
      syncRoomTypeAvailability(serverRooms);
      return;
    }
    if (!serverRooms.length && editor.rooms.length) {
      // FALSCHE Leer-Sync-Verdacht: Der Server kennt die Räume nicht mehr,
      // aber der Editor HAT sie -> nicht löschen, sondern hochreparieren.
      ensureSocket().emit('map:update', {
        code: state.code,
        map: { ...editor.working, rooms: editor.rooms, connections: [] },
      });
      syncRoomTypeAvailability(serverRooms);
      return;
    }
    editor.setRooms(serverRooms);
    syncRoomTypeAvailability(serverRooms);
  }

  function syncRoomTypeAvailability(serverRooms) {
    // Genau ein Raum pro Sorte: belegte Typen disablen, Typ-Grid updaten.
    const used = new Set(serverRooms
      .filter((r) => r.type !== 'NORMAL')
      .map((r) => r.type));
    document.querySelectorAll('#room-type-grid button').forEach((btn) => {
      const type = btn.dataset.roomType;
      const taken = used.has(type);
      btn.disabled = taken;
      if (taken && state.editorRoomType === type) {
        state.editorRoomType = 'CAFETERIA';
      }
    });
    highlightRoomType();
  }

  editor.onRoomDraft = (polygonPts) => {
    if (polygonPts.length < 3) {
      editor.discardRoom();
      showToast('Raum braucht mindestens 3 Punkte.');
      return;
    }
    const type = state.editorRoomType ?? 'CAFETERIA';
    const room = editor.commitRoom(ROOM_NAME_BY_TYPE[type] ?? type, type);
    if (!room) return;
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { ...editor.working, rooms: editor.rooms, connections: [] },
    });
    showToast(`Raum "${room.name}" angelegt (${editor.rooms.length} total).`);
    beep(880);
    $('room-type-picker').classList.add('hidden');
    $('btn-room-mode').classList.remove('primary');
    $('btn-room-mode').textContent = 'Raum zeichnen';
  };

  $('room-type-grid').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-room-type]');
    if (!btn) return;
    state.editorRoomType = btn.dataset.roomType;
    highlightRoomType();
    showToast(`Raum-Typ: ${ROOM_NAME_BY_TYPE[state.editorRoomType]} — jetzt zeichnen.`);
    beep(660);
  });

  $('btn-room-mode').addEventListener('click', () => {
    editor.setRoomMode(!editor.roomMode);
    $('room-type-picker').classList.toggle('hidden', !editor.roomMode);
    if (editor.roomMode) {
      highlightRoomType();
      syncRoomEditorFromServer(state.room ?? {}); // Grid-Sperrung nach Stand
    }
    $('btn-room-mode').classList.toggle('primary', editor.roomMode);
    $('btn-room-mode').textContent = editor.roomMode
      ? 'Raummodus beenden'
      : 'Raum zeichnen';
    $('map-hint').textContent = editor.roomMode
      ? 'Typ oben antippen, dann Punkte zeichnen. Ersten Punkt ANtippen schliesst. Bestehenden Raum LONG-TIPPEN (0,5s) = l\u00f6schen.'
      : 'Tippe eine Stra\u00dfe an, um sie auszuw\u00e4hlen.';
  });

  $('btn-room-undo').addEventListener('click', () => editor.undoRoomPoint());

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
    $('cfg-taskradius').value = `${cfg.taskRadiusM ?? 8}`;
    $('cfg-cooldown').value = `${Math.round((cfg.killCooldownMs ?? 0) / 1000)}`;
    $('cfg-discuss').value = `${Math.round((cfg.discussionDurationMs ?? 0) / 1000)}`;
    $('cfg-vote').value = `${Math.round((cfg.votingDurationMs ?? 60_000) / 1000)}`;
    $('cfg-emergency').value = `${cfg.emergencyMeetingsPerPlayer ?? 1}`;
    $('cfg-boundary').value = `${cfg.boundaryWarnM ?? 10}`;
    $('cfg-anonymous').checked = !!cfg.anonymousVoting;
    $('cfg-confirm').checked = cfg.confirmEjects !== false;
    $('cfg-taskbar').checked = cfg.taskbarAlways !== false;
    state.taskbarAlways = cfg.taskbarAlways !== false;
  }

  $('cfg-apply').addEventListener('click', () => {
    ensureSocket().emit('game:update_config', {
      code: state.code,
      config: {
        impostorCount: Number($('cfg-impostors').value),
        tasksPerCrewmate: Number($('cfg-tasks').value),
        killRadiusM: Number($('cfg-kill-radius').value),
        taskRadiusM: Number($('cfg-taskradius').value),
        killCooldownMs: Number($('cfg-cooldown').value) * 1000,
        discussionDurationMs: Number($('cfg-discuss').value) * 1000,
        votingDurationMs: Number($('cfg-vote').value) * 1000,
        emergencyMeetingsPerPlayer: Number($('cfg-emergency').value),
        boundaryWarnM: Number($('cfg-boundary').value),
        anonymousVoting: $('cfg-anonymous').checked,
        confirmEjects: $('cfg-confirm').checked,
        taskbarAlways: $('cfg-taskbar').checked,
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
    // Tap-Handler ZUERST registrieren — egal was danach knallt, der Spieler
    // kommt beim Tappen auf jeden Fall weiter (IRL-Freeze-Fix).
    const dismiss = () => {
      window.clearTimeout(showRoleOverlay._t);
      overlay.onclick = null;
      overlay.classList.add('hidden');
      beep(impostor ? 180 : 560);
    };
    overlay.onclick = dismiss;
    window.clearTimeout(showRoleOverlay._t);
    showRoleOverlay._t = window.setTimeout(dismiss, ROLE_OVERLAY_MS);
    try {
      overlay.classList.remove('hidden');
      $('role-card').className = impostor ? 'role-card impostor' : 'role-card crew';
      const title = $('role-card-title');
      title.textContent = impostor ? t('role.imp.title') : t('role.crew.title');
      title.classList.add('pixel-title');
      const chipOf = (name, self, mate) => {
        const label = `${escapeHtml(name)}${self ? ' (Du)' : ''}`;
        return `<span class="role-chip${mate ? ' mate' : ''}${self ? ' self' : ''}">${label}</span>`;
      };
      const playerNames = (state.room?.players ?? []).map((p) => p.name);
      const selfName = state.room?.players?.find((p) => p.id === state.playerId)?.name;
      const impCount = impostor
        ? (payload.teammates?.length ?? 0) + 1
        : (state.room?.config?.impostorCount ?? 1);
      if (impostor) {
        const mates = (payload.teammates ?? []);
        $('role-card-detail').innerHTML =
          `${t('role.imp.line1')}<br>`
          + `<span class="pixel-sub">Es ${impCount === 1 ? 'ist' : 'sind'} ${impCount} Impostor${impCount === 1 ? '' : 'en'} unter euch${mates.length ? ` &mdash; ${t('game.partner')}:</span>` : '.</span>'}`
          + (mates.length
            ? `<div class="role-row">${mates.map((mate) => chipOf(mate.name, false, true)).join('')}</div>`
            : '<div class="role-row"><span class="role-chip mate">Du bist alleiniger Impostor</span></div>')
          + `<small>${t('role.tap')}</small>`;
      } else {
        $('role-card-detail').innerHTML =
          `${t('role.crew.line1')} ${t('role.crew.and')}<br>`
          + `<span class="pixel-sub">Es ${impCount === 1 ? 'ist' : 'sind'} <b class="imp-count">${impCount}</b> Impostor${impCount === 1 ? '' : 'en'} unter uns:</span>`
          + `<div class="role-row">${playerNames.map((name) => chipOf(name, name === selfName, false)).join('')}</div>`
          + `<small>${t('role.tap')}</small>`;
      }
      $('role-banner').classList.add('hidden');
      $('btn-kill').classList.toggle('hidden', !impostor);
      renderRole(payload); // task list build + flags + teammates line
    } catch (error) {
      // UI darf nie den Spieler einfrieren — Fehler sichtbar machen.
      showJsError(error);
    }
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
    // Tap a task to open its minigame (gated by proximity in openTask).
    const list = $('task-list');
    list.innerHTML = '';
    for (const task of payload.tasks ?? []) {
      const li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.taskId = task.id;
      li.innerHTML = `<span>${TASK_ICONS[task.type] ?? '\u{1F4DD}'} ${escapeHtml(task.title)}</span>` +
        (task.roomName ? `<small>${escapeHtml(task.roomName)}${task.stages?.length > 1 ? ` \u2022 ${t('tasks.stage')} ${(task.stageIndex ?? 0) + 1}` : ''}</small>` : '');
      li.addEventListener('click', () => openTask(task));
      list.appendChild(li);
    }
    state.tasks = payload.tasks ?? [];
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
    const strip = document.getElementById('task-progress-strip');
    if (!strip) return;
    // Host kann den Balken komplett verstecken (Info-Control-Knopf).
    const label = document.getElementById('task-progress-strip-label');
    if (state.taskbarAlways === false) {
      strip.style.display = 'none';
      if (label) label.style.display = 'none';
      return;
    }
    if (label) label.style.display = '';
    strip.style.display = '';
    const before = document.getElementById('task-progress-fill').style.width;
    // COMMS gest\u00f6rt: Crew kann den Team-Fortschritt nicht sehen.
    const commsBlind = room.sabotage?.type === 'COMMS' && state.role?.role !== 'IMPOSTOR';
    const shown = commsBlind ? before : `${pct}%`;
    if (shown !== before) {
      document.getElementById('task-progress-fill').style.width = shown;
      strip.classList.remove('flash');
      void strip.offsetWidth; // restart the pop animation
      strip.classList.add('flash');
    }
    strip.style.opacity = commsBlind ? '0.25' : '1';
  }

  /** Report/Kill-Buttons je nach Nähe (Kill nur mit echten Zielen). */
  function renderGameHud() {
    const room = state.room;
    if (!room || room.status !== 'IN_GAME') return;
    const imAlive = room.players.find((p) => p.id === state.playerId)?.isAlive;
    const commsDown = room.sabotage?.type === 'COMMS';
    const notImpostor = state.role?.role !== 'IMPOSTOR';
    // Comms-Sabotage: Taskliste + Marker verstecken (Crew ist blind).
    const taskbox = $('taskbox');
    const commsBlind = commsDown && notImpostor;
    taskbox.querySelector('summary').textContent = commsBlind
      ? t('comms.down')
      : `${t('tasks.summary')} (${state.tasks?.filter((x) => !x.completed).length ?? 0})`;
    $('task-list').style.display = commsBlind ? 'none' : '';
    const bodies = state.nearbyBodies ?? [];
    const reportBtn = $('btn-report');
    reportBtn.disabled = !(bodies.length && imAlive !== false);
    reportBtn.classList.toggle('ready', bodies.length > 0 && imAlive !== false);
    const killBtn = $('btn-kill');
    if (!killBtn.classList.contains('hidden')) {
      const killLabel = killBtn.querySelector('.icon-label');
      const targets = state.killTargets ?? [];
      const cooldownLeft = Math.max(0, state.killReadyAt - Date.now());
      if (cooldownLeft > 0) {
        // Cooldown IMMER auf dem Knopf sichtbar (auch ohne Ziel in	range).
        killBtn.disabled = true;
        if (killLabel) killLabel.textContent = `${Math.ceil(cooldownLeft / 1000)}s`;
      } else {
        killBtn.disabled = !targets.length;
        if (killLabel) killLabel.textContent = 'Kill';
      }
      killBtn.classList.toggle('ready', targets.length > 0 && cooldownLeft <= 0);
    }
    updateUseButton();
    updateEmergencyBig();
    updateSabotageButton();
  }

  /** Task-Distanz: gleicher Raum \u00fcber roomId oder <4.2m (Server-Gate). */
  function taskNear(task) {
    const radius = state.room?.config?.taskRadiusM ?? 8;
    if (task.roomId && state.selfPos?.roomId === task.roomId) return true;
    if (task.x == null || !state.selfPos || state.selfPos.x == null) return false;
    return Math.hypot(state.selfPos.x - task.x, state.selfPos.y - task.y) <= radius;
  }

  /** \u00d6ffnet das Task-Minigame, wenn N\u00e4he + Regeln passen. */
  function openTask(task) {
    if (!state.room || state.room.status !== 'IN_GAME') {
      showToast('Tasks gehen nur im Spiel.');
      return;
    }
    if (state.room.players?.find((p) => p.id === state.playerId)?.isAlive === false) {
      showToast('Geister k\u00f6nnen keine Tasks machen.');
      return;
    }
    if (task.completed) {
      showToast('Dieser Task ist schon fertig.');
      return;
    }
    if (state.room?.sabotage?.type === 'COMMS') {
      showToast('Kein Netz \u2014 Communications sind sabotiert!');
      return;
    }
    if (!taskNear(task)) {
      showToast(task.roomName
        ? `Zu weit weg \u2014 geh nach ${task.roomName}.`
        : 'Zu weit weg \u2014 geh zum Task-Marker.');
      beep(220);
      return;
    }
    window.RlausTasks?.launch(task, () => {
      sfx('task_done');
      ensureSocket().emit('task:complete', { code: state.code, taskId: task.id });
      vibrate(80);
    });
    if (window.RlausTasks?.launch) sfx('task_open');
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
      if (sab.type === 'LIGHTS' && roomIdContains('ELECTRICAL')) {
        return { label: 'Licht Fix', kind: 'FIX', panel: 'LIGHTS' };
      }
      if (sab.type === 'COMMS' && roomIdContains('COMMUNICATIONS')) {
        return { label: 'Comms Fix', kind: 'FIX', panel: 'COMMS' };
      }
      return null;
    }
    const task = nearestIncompleteTask();
    if (task) {
      return { label: task.title, kind: 'TASK', task };
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
    const radius = state.room?.config?.taskRadiusM ?? 8;
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
    return bestDist <= radius ? best : null;
  }

  function emergencyLeft() {
    // Der Server z\u00e4hlt (emergencyUsed) \u2014 lokal tasten wir 1 pro Spieler.
    return state.role && !(state._usedEmergency) ? 1 : 0;
  }

  /**
   * Divo-Design: Großer roter 3D-Notfallknopf mit Glas-Kappe, NUR wenn
   * du am Meeting-Point (CAFETERIA) stehst. Kappe zu = blockiert
   * (kritische Sabotage / keine Meetings mehr / Tote drücken nicht).
   */
  function updateEmergencyBig() {
    const wrap = $('emergency-big');
    const btn = $('btn-emergency');
    if (!wrap || !btn) return;
    const room = state.room;
    const inGame = room?.status === 'IN_GAME'
      && room.players?.find((p) => p.id === state.playerId)?.isAlive !== false;
    const atMeetingTable = roomIdContains('CAFETERIA');
    const sab = room?.sabotage;
    const critical = sab && ['REACTOR', 'O2'].includes(sab.type);
    const canPress = inGame && atMeetingTable && emergencyLeft() > 0 && !critical;
    wrap.classList.toggle('hidden', !(inGame && atMeetingTable));
    if (!(inGame && atMeetingTable)) return;
    btn.classList.toggle('blocked', !canPress);
    btn.classList.toggle('open', canPress);
    btn.disabled = !canPress;
    btn.querySelector('.emergency-face').textContent = critical
      ? 'BLOCKIERT'
      : 'NOTFALL';
  }

  $('btn-emergency')?.addEventListener('click', () => {
    const btn = $('btn-emergency');
    if (btn.disabled) {
      sfx('ui_select', 0.4);
      showToast('Knopf geht nicht \u2014 Sabotage l\u00e4uft oder keine Meetings mehr.');
      return;
    }
    if (!(roomIdContains('CAFETERIA') && emergencyLeft() > 0)) return;
    sfx('ui_select', 0.8);
    vibrate([60, 40, 60]);
    // Kappe-fallende Zeremonie (~1s), DANN startet das Meeting.
    btn.classList.add('pressed');
    btn.disabled = true;
    state._usedEmergency = true;
    setTimeout(() => {
      btn.classList.remove('pressed');
      ensureSocket().emit('game:emergency', { code: state.code });
    }, 900);
  });

  function updateUseButton() {
    const useBtn = $('btn-use');
    const useLabel = useBtn.querySelector('.icon-label');
    const action = useAction();
    if (useLabel) useLabel.textContent = action ? action.label : 'Use';
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
    sabBtn.classList.toggle('hidden', !impostor || state.room?.status !== 'IN_GAME' ||
      state.room?.players?.find((p) => p.id === state.playerId)?.isAlive === false);
    if (!impostor) return;
    const sab = state.room?.sabotage;
    const sabLabel = sabBtn.querySelector('.icon-label');
    const setSabLabel = (text) => {
      if (sabLabel) sabLabel.textContent = text;
    };
    if (sab) {
      // Aktive Sabotage: Restzeit mit auf den Knopf statt vages "Laeuft".
      if (sab.deadline) {
        const left = Math.max(0, Math.ceil((Date.parse(sab.deadline) - Date.now()) / 1000));
        setSabLabel(`${sab.type} ${left}s`);
      } else {
        setSabLabel('L\u00e4uft');
      }
      sabBtn.disabled = true;
      return;
    }
    // Cooldown bis zur naechsten Sabotage als Countdown auf dem Knopf.
    const cd = state.room?.sabotageCooldownUntil ?? 0;
    const left = Math.max(0, Math.ceil((cd - Date.now()) / 1000));
    if (left > 0) {
      setSabLabel(`${left}s`);
      sabBtn.disabled = true;
      return;
    }
    setSabLabel('Sabotage');
    sabBtn.disabled = false;
  }

  /**
   * Sabotage-Auswahl: Impostor w\u00e4hlt zwischen verf\u00fcgbaren Sabotagen
   * (abh\u00e4ngig von den gemappten R\u00e4umen). Soft-Sabotagen k\u00f6nnen eine
   * laufende Soft-Sabotage ersetzen.
   */
  function openSabotageSelect() {
    const types = sabotageTypesAvailable();
    if (!types.length) {
      showToast('Keine Sabotage f\u00fcr diese Karte verf\u00fcgbar.');
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'task-overlay';
    const card = document.createElement('div');
    card.className = 'task-card sabotage-select';
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = 'Sabotage w\u00e4hlen';
    card.appendChild(title);
    const meta = {
      REACTOR: { label: '\u2622\uFE0F Reactor Meltdown', hint: '2 Crew im Reactor \u2014 30s Countdown' },
      O2: { label: '\u26FD O2 D\u00e4mpfung', hint: 'Fix an O2 UND Admin \u2014 30s Countdown' },
      LIGHTS: { label: '\u{1F4A1} Lichter aus', hint: 'Niemand sieht Leichen \u2014 Fix in Electrical' },
      COMMS: { label: '\u{1F4E1} Comms gest\u00f6rt', hint: 'Taskliste weg \u2014 Fix in Communications' },
    };
    for (const type of types) {
      const btn = document.createElement('button');
      btn.className = 'task-tap-btn sabotage-choice';
      btn.innerHTML = `<strong>${meta[type]?.label ?? type}</strong>` +
        `<small>${meta[type]?.hint ?? ''}</small>`;
      btn.addEventListener('click', () => {
        overlay.remove();
        ensureSocket().emit('game:sabotage', { code: state.code, type });
        vibrate(60);
      });
      card.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = 'Abbrechen';
    cancel.addEventListener('click', () => overlay.remove());
    card.appendChild(cancel);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  /** Sabotage-Typen, die die aktuelle Karte hergibt (React/O2/EC/COMMS). */
  function sabotageTypesAvailable() {
    const types = (state.room?.map?.rooms ?? []).map((room) => room.type);
    const allowed = [];
    if (types.includes('REACTOR')) allowed.push('REACTOR');
    if (types.includes('O2')) allowed.push('O2');
    if (types.includes('ELECTRICAL')) allowed.push('LIGHTS');
    if (types.includes('COMMUNICATIONS')) allowed.push('COMMS');
    return allowed;
  }
  setInterval(renderGameHud, 500);
  // Selbst-Marker-Puls: weiche Dauerwelle auf der Karte + GPS-Status.
  // 300ms statt 800ms: Der Marker "fliegt" live mit dir (Feedback aus
  // dem Draußen-Test: 2s-Schritte sahen hackelich aus).
  setInterval(() => {
    renderGpsStatus();
    if (state.room?.status === 'IN_GAME') drawGameMap();
  }, 300);

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
    if (sab.type === 'REACTOR' && sab.deadline) {
      banner.textContent = `\u2622\uFE0F REACTOR MELTDOWN \u2014 ${t('sab.reactor')} ${remaining}s`;
    } else if (sab.type === 'O2' && sab.deadline) {
      const o2 = sab.panels?.o2 ? '\u2705' : '\u274C';
      const admin = sab.panels?.admin ? '\u2705' : '\u274C';
      banner.textContent = `\u26A0\uFE0F ${t('sab.o2')} ${o2} + Admin ${admin} \u2014 ${remaining}s`;
    } else if (sab.type === 'LIGHTS') {
      banner.textContent = `\u{1F4A1} ${t('sab.lights')}`;
    } else if (sab.type === 'COMMS') {
      banner.textContent = `\u{1F4E1} ${t('sab.comms')}`;
    } else {
      return;
    }
    banner.classList.remove('hidden');
    banner.classList.toggle('reactor-war', sab.deadline != null);
    banner.classList.toggle('o2-war', sab.deadline == null);
    renderGameHud();
  }
  setInterval(renderSabotage, 1000);

  // ------------------------------------------------------------ gps loop //

  /** GPS->Meter Projektion auf Basis des gespeicherten Karten-Ankers. */
  function projectorFor(key = null) {
    if (key) return key === state.projKey ? state.proj : null;
    // Bevorzugt: 2-Punkt-Kalibrierung (permanent, gedreht + skaliert).
    const mapData = state.room?.map;
    const cal = mapData?.cal;
    if (cal?.p1 && cal?.p2 && Number.isFinite(cal.p1.lat)) {
      const calKey = `cal:${mapData.version ?? 0}:${Math.round(cal.p1.x)}:${Math.round(cal.p1.y)}`;
      if (state.projKey !== calKey) {
        state.proj = twoPointProjector(cal);
        state.projKey = state.proj ? calKey : null;
      }
      return state.proj;
    }
    const anchor = mapData?.anchor;
    if (!anchor || typeof anchor.lat !== 'number') return null;
    const cacheKey = `${anchor.lat}:${anchor.lon}`;
    if (state.projKey !== cacheKey) {
      state.projKey = cacheKey;
      state.proj = OSM.createProjector(anchor.lat, anchor.lon);
    }
    return state.proj;
  }

  /**
   * 2-Punkt-Projektor: aus zwei Karte<->GPS-Paaren ergibt sich Versatz,
   * Drehung und Maßstab (Abstand in Welt- vs. Kartemetern, Winkel der
   * Richtungen). Die Karte darf also beliebig schief gezeichnet sein.
   * Welt- und Kartenmeter nutzen dieselbe Achsenlage (x=ost, y=sued).
   */
  function twoPointProjector(cal) {
    const m = 111_320;
    const cos1 = Math.max(0.2, Math.cos((cal.p1.lat * Math.PI) / 180));
    const wx = (cal.p2.lon - cal.p1.lon) * m * cos1;
    const wy = -(cal.p2.lat - cal.p1.lat) * m;
    const mx = cal.p2.x - cal.p1.x;
    const my = cal.p2.y - cal.p1.y;
    const mapLen = Math.hypot(mx, my);
    const worldLen = Math.hypot(wx, wy);
    if (!mapLen || !worldLen) return null;
    // Die Karte ist handgezeichnet und NICHT maßstabsgetreu: der Skalier-
    // faktor funkt die Welt in das gezeichnete Verhältnis hinein (p2
    // muss landen EXAKT auf p2's Kartenpunkt).
    const scale = mapLen / worldLen;
    // Drehung, die den Weltvektor in den Kartenvektor schwenkt.
    const theta = Math.atan2(my, mx) - Math.atan2(wy, wx);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    return {
      project(lat, lon) {
        // Weltmeter relativ zu p1 (equirectangular=Grobfahrt).
        const ax = (lon - cal.p1.lon) * m * cos1;
        const ay = -(lat - cal.p1.lat) * m;
        return [
          (ax * cosT - ay * sinT) * scale + cal.p1.x,
          (ax * sinT + ay * cosT) * scale + cal.p1.y,
        ];
      },
      unproject(x, y) {
        // Inverse von R(s·θ): Karte-Meter -> Weltmeter -> lat/lon.
        const dx = (x - cal.p1.x) / scale;
        const dy = (y - cal.p1.y) / scale;
        const ax = dx * cosT + dy * sinT;
        const ay = -dx * sinT + dy * cosT;
        return [cal.p1.lat - ay / m, cal.p1.lon + ax / (m * cos1)];
      },
      anchor: { lat: cal.p1.lat, lon: cal.p1.lon },
    };
  }

  // ---- Motion-Fusion: Beschleunigung + Kompass ----
  // Ziel: wissen, ob sich das Handy WIRKLICH bewegt, bevor GPS das beweist
  // (GPS braucht ~1-4s bis ein Lauf sichtbar wird). Fuer iOS muss die
  // Sensor-Freigabe in einer User-Geste passieren -> erster Tap registriert.
  function onMotionUpdate(event) {
    const acc = event.accelerationIncludingGravity ?? event.acceleration;
    if (!acc || (acc.x == null && acc.y == null)) return;
    const mag = Math.hypot(acc.x ?? 0, acc.y ?? 0, acc.z ?? 0);
    // Langsame Baseline (Schwerkraft ~9.8): Abweichung von ihr = Bewegungs-
    // energie. EMA ~1s Halbwertszeit -> Gehen/Schwelen schaufelt hoch,
    // ruhige Tasche bleibt unten.
    const base = state._accBase ?? (state._accBase = { v: mag });
    base.v += (mag - base.v) * 0.06;
    const dev = Math.abs(mag - base.v);
    state.motionEnergy = (state.motionEnergy ?? 0) * 0.88 + dev * 0.12;
    state.sensorMoving = state.motionEnergy > 0.35;
  }

  function onOrientationUpdate(event) {
    const heading = event.webkitCompassHeading
      ?? (event.alpha != null ? (360 - event.alpha) % 360 : null);
    if (heading != null && Number.isFinite(heading)) {
      state.sensorHeading = heading;
    }
  }

  function attachMotionSensors() {
    if (state._motionAttached) return;
    const geoDmo = window.DeviceMotionEvent;
    const geoDoe = window.DeviceOrientationEvent;
    if (!geoDmo) return; // Desktop: kein Fusion-Vorteil, GPS reicht
    // iOS 13+: Berechtigungsdialog NUR in User-Geste erlaubt.
    if (typeof geoDoe?.requestPermission === 'function' && !state._motionAsked) {
      state._motionAsked = true;
      geoDoe.requestPermission().then((resp) => {
        if (resp === 'granted') {
          state._motionAttached = true;
          window.addEventListener('deviceorientation', onOrientationUpdate);
        }
      }).catch(() => {}); // verweigert: GPS-only weiterlaufen lassen
      return;
    }
    state._motionAttached = true;
    window.addEventListener('devicemotion', onMotionUpdate, { passive: true });
    window.addEventListener('deviceorientation', onOrientationUpdate);
  }

  document.addEventListener('pointerdown', () => attachMotionSensors(), { once: true });

  ensureGpsLoop.started = false;
  function ensureGpsLoop() {
    if (!('geolocation' in navigator) || ensureGpsLoop.started) return;
    ensureGpsLoop.started = true;
    attachMotionSensors();
    navigator.geolocation.watchPosition((pos) => {
      state.gpsFix = pos.coords;
      state.gpsFixAt = Date.now();
      state.gpsError = null;
      // Für Genauigkeits-Kreis + Richtungs-Pfeil auf der Karte.
      state.gpsAccM = pos.coords.accuracy ?? null;
      state.gpsHeading = (pos.coords.speed ?? 0) > 0.5
        && typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading)
        ? pos.coords.heading : null;
    }, (err) => {
      // Kein stillschweigendes Schlucken mehr: der Spieler sieht WARUM
      // sein Marker fehlt (Berechtigung verweigert / kein Fix / Timeout).
      state.gpsError = err?.code === 1 ? 'denied'
        : err?.code === 2 ? 'unavailable' : 'waiting';
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 });
    // Grobe Rucksack-Quelle: falls High-Accuracy h\u00e4ngt, liefert der
    // Coarse-Watcher sp\u00e4testens f\u00fcr die Marker-Position etwas.
    navigator.geolocation.watchPosition((pos) => {
      if (Date.now() - (state.gpsFixAt ?? 0) > 20000) {
        state.gpsFix = pos.coords;
        state.gpsFixAt = Date.now();
        state.gpsError ??= null;
      }
    }, () => {}, { enableHighAccuracy: false, maximumAge: 15000, timeout: 30000 });
  }

  /** GPS-Hinweiszeile im Spiel: nur sichtbar, wenn etwas nicht stimmt. */
  function renderGpsStatus() {
    const el = document.getElementById('gps-status');
    if (!el) return;
    const inGame = state.room?.status === 'IN_GAME';
    if (!inGame) { el.classList.add('hidden'); return; }
    const proj = projectorFor();
    let msg = null;
    if (!('geolocation' in navigator)) msg = t('gps.noapi');
    else if (state.gpsError === 'denied') msg = t('gps.denied');
    else if (state.gpsError === 'unavailable') msg = t('gps.unavailable');
    else if (!state.gpsFixAt) msg = t('gps.waiting');
    else if (!proj) msg = t('gps.noanchor');
    else if (Date.now() - state.gpsFixAt > 10000) msg = t('gps.lost');
    if (msg) {
      el.textContent = `\ud83d\udcdb ${msg}`;
      el.classList.add('hidden');
      el.classList.remove('hidden');
      if (renderGpsStatus.lastMsg !== msg && msg !== t('gps.waiting')) {
        logAppError('gps', msg);
        renderGpsStatus.lastMsg = msg;
      }
    } else {
      el.classList.add('hidden');
      renderGpsStatus.lastMsg = null;
    }
  }

  function stopGpsLoop() {
    // Watcher bleibt billig aktiv; der Sendetakt prüft den Status selbst.
    state.nearbyBodies = [];
  }

  /**
   * Straßen-Daten: das SAVED map hat nodes+corridors aus den geladenen
   * OSM-Straßen — genau die Segmente gelten im Spiel als begehbar.
   * Wir schnappen die Position an das naheste korridor-Segment, sofern
   * wir NICHT in einem Raum stehen (drin gilt exakte GPS-Wahrheit).
   * Resultat: der Pin klebt draußen an der Straße statt im Gebüsch,
   * und Position/-Abstände stimmen mit der Server-Logik überein.
   */
  function snapToStreets(x, y) {
    const map = state.room?.map;
    const corridors = map?.corridors ?? [];
    if (!map?.nodes?.length || !corridors.length) return null;
    const nodeById = new Map(map.nodes.map((n) => [n.id, n]));
    let best = null;
    let bestDist = Infinity;
    for (const corridor of corridors) {
      const a = nodeById.get(corridor.a);
      const b = nodeById.get(corridor.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq
        ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq))
        : 0;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        best = [px, py];
      }
    }
    // Nur nah genug (12m) darf ziehen — weit Draußen bleibt ehrlich Draußen.
    return best && bestDist <= 12 ? best : null;
  }

  setInterval(() => {
    const room = state.room;
    // Nur im Spiel senden — sonst stoppen (Fix für NOT_IN_ROOM-Spam
    // aus dem Fehler-Tagebuch: Nach Rundenende flippte die Schleife).
    if (!room || room.status !== 'IN_GAME' || !state.gpsFixAt) return;
    if (Date.now() - state.gpsFixAt > 10000) return;
    if (!state.socket?.connected) return;
    const proj = projectorFor();
    if (!proj) return;
    // GPS-LIVE-TRACKING v2 (Divo: 'gelaufen, gerannt, Marker steckte'):
    // 6s-Fenster entscheidet STILL vs. BEWEGT, Beschleunigungssensor
    // zeigt noch VOR dem GPS, dass Bewegung anläuft. Kein starrer
    // Quiet-Brake mehr — der hat ECHTES Gehen zäh gebremst. Bei Stillstand
    // wandert der Marker aufs Fenster-Zentrum (keine Tisch-Reise), bei
    // Bewegung folgt er schnell (alpha nach Genauigkeit) + Dead-Reckoning-
    // Gleit zwischen den GPS-Fixes, damit das Ganze fließt statt ruckt.
    const nowMs = Date.now();
    const raw = proj.project(state.gpsFix.latitude, state.gpsFix.longitude);
    const accuracy = state.gpsFix.accuracy ?? 30;
    const smooth = state.posSmooth ?? { x: raw[0], y: raw[1] };
    const jump = Math.hypot(raw[0] - smooth.x, raw[1] - smooth.y);
    // Fixe nur einmal ins Fenster (GPS tickt pro Sekunde, Loop 300ms).
    const trail = state.gpsTrail ?? (state.gpsTrail = []);
    const lastPt = trail[trail.length - 1];
    if (!lastPt || Math.hypot(raw[0] - lastPt.x, raw[1] - lastPt.y) > 0.15
      || nowMs - lastPt.t > 1200) {
      trail.push({ x: raw[0], y: raw[1], t: nowMs });
    }
    while (trail.length > 2 && nowMs - trail[0].t > 6000) trail.shift();
    const first = trail[0];
    const travel = Math.hypot(raw[0] - first.x, raw[1] - first.y);
    const sensorMoving = !!state.sensorMoving;
    const isStill = travel < 1.8 && !sensorMoving && jump < 8;
    let alpha;
    if (isStill) {
      // Still: Ziel ist der Festnkel-Mittel aus dem Fenster (Jitter-Tisch).
      if (jump > 15) {
        alpha = 0.05; // GPS-Glitch statt echte Bewegung -> an Ort halten
      } else {
        let cx = 0; let cy = 0;
        for (const p of trail) { cx += p.x; cy += p.y; }
        cx /= trail.length; cy /= trail.length;
        smooth.x += (cx - smooth.x) * 0.5;
        smooth.y += (cy - smooth.y) * 0.5;
        alpha = null;
      }
    } else {
      // Bewegung: zügig folgen, schwach empfangene Fixe etwas zäher.
      alpha = accuracy <= 10 ? 0.65 : accuracy <= 25 ? 0.5 : 0.35;
      if (jump > 15 || nowMs - (state.gpsFixAt ?? 0) > 4000) alpha = 1;
    }
    if (alpha != null) {
      smooth.x += (raw[0] - smooth.x) * alpha;
      smooth.y += (raw[1] - smooth.y) * alpha;
    }
    // Dead-Reckoning-Glide: Zwischen GPS-Fixes (~1s Lücke) geht marker
    // mit geschätzter Tempo-Richtung weiter — Bewegungen wirken fluide.
    if (!isStill) {
      const prev = state.gpsPrevFix;
      if (prev) {
        const dt = Math.max(0.25, Math.min(4, (nowMs - prev.t) / 1000));
        const dx = (raw[0] - prev.x) / dt;
        const dy = (raw[1] - prev.y) / dt;
        const sp = Math.hypot(dx, dy);
        if (sp > 0.2 && sp < 8) { // realistisch: 0.2..8 m/s
          state.velEst ??= { vx: 0, vy: 0 };
          state.velEst.vx += (dx - state.velEst.vx) * 0.4;
          state.velEst.vy += (dy - state.velEst.vy) * 0.4;
        }
      }
      state.gpsPrevFix = { x: raw[0], y: raw[1], t: nowMs };
    } else {
      state.velEst = null;
      state.gpsPrevFix = null;
    }
    const sinceFix = nowMs - (state.gpsFixAt ?? nowMs);
    if (!isStill && state.velEst && sinceFix > 1100) {
      smooth.x += state.velEst.vx * 0.28;
      smooth.y += state.velEst.vy * 0.28;
      if (jump > 30) { smooth.x = raw[0]; smooth.y = raw[1]; }
    }
    // Straßen-Fixierung außerhalb von Räumen: Der Pin "liegt" auf der
    // Straße. In Räumen bleibt exakte GPS-Wahrheit (Task/Kill-Nähe).
    const snap = !state.selfPos?.roomId ? snapToStreets(smooth.x, smooth.y) : null;
    state.snapped = snap ?? false;
    const [tx, ty] = snap ?? [smooth.x, smooth.y];
    state.posSmooth = smooth;
    state.displayPos = { x: state.snapped ? tx : smooth.x, y: state.snapped ? ty : smooth.y };
    const confidence = Math.min(1, Math.max(0, (60 - accuracy) / 60));
    const moved = state.lastSentPos
      ? Math.hypot(state.displayPos.x - state.lastSentPos.x, state.displayPos.y - state.lastSentPos.y)
      : Infinity;
    const sinceSend = Date.now() - (state.lastSent?.at ?? 0);
    // Nach POSITION_UNREALISTIC erst beruhigen (3s) statt Sturm spammen.
    if (Date.now() < (state._posHoldUntil ?? 0)) return;
    // Bestätigte Position nochmal senden, bis der Server sie annimmt —
    // der vergleicht gegen sie, dann läuft der Anker wieder sauber an.
    if ((state._posRejectStreak ?? 0) > 0 && state.selfPos?.x != null) {
      emitPosition({ x: state.selfPos.x, y: state.selfPos.y,
        confidence: state.selfPos.confidence ?? 0.5 });
      return;
    }
    // Bewegen sich wir >1,5m -> so schnell wie sinnvoll (>=600ms);
    // stehen wir -> nur alle 2s (Batterie + Serverlast).
    if (moved > 1.5 && sinceSend < 600) return;
    if (moved <= 1.5 && sinceSend < 2000) return;
    emitPosition({ x: state.displayPos.x, y: state.displayPos.y, confidence });
  }, 300);

  function emitPosition({ x, y, confidence }) {
    state.lastSent = { at: Date.now() };
    state.lastSentPos = { x, y };
    const socket = ensureSocket();
    socket.emit('position:update', {
      code: state.code,
      x,
      y,
      confidence,
      source: 'GPS',
    });
  }

  // Icon je Task-Typ — der Marker auf der Karte zeigt das Symbol statt
  // einer Nummer, die Task-Liste nutzt dasselbe Icon (wiedererkennbar).
  const TASK_ICONS = {
    fix_wiring: '\u{1F50C}',
    swipe_card: '\u{1F4B3}',
    upload_data: '\u{1F4E4}',
    calibrate_distributor: '\u2699\uFE0F',
    start_reactor: '\u2622\uFE0F',
    unlock_manifolds: '\u{1F513}',
    enter_id_code: '\u{1F194}',
    reset_breakers: '\u26A1',
    chart_course: '\u{1F5FA}\uFE0F',
    clean_o2_filter: '\u{1F343}',
    empty_garbage: '\u{1F5D1}\uFE0F',
    divert_power: '\u{1F500}',
    align_engine_output: '\u{1F4CF}',
    stabilize_steering: '\u{1F3AF}',
    clear_asteroids: '\u2604\uFE0F',
    prime_shields: '\u{1F6E1}\uFE0F',
    inspect_sample: '\u{1F9EA}',
    submit_scan: '\u{1FA7A}',
    fuel_engines: '\u26FD',
    align_engine: '\u{1F4CF}',
    align_engine_output: '\u{1F4CF}',
  };

  // -------------------------------------------------------- live map draw //

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
    const fitMinX = Math.min(...map.nodes.map((n) => n.x));
    const fitMaxX = Math.max(...map.nodes.map((n) => n.x));
    const fitMinY = Math.min(...map.nodes.map((n) => n.y));
    const fitMaxY = Math.max(...map.nodes.map((n) => n.y));
    const fitW = fitMaxX - fitMinX || 50;
    const fitH = fitMaxY - fitMinY || 50;
    const pad = 20;
    const halfW = canvas.width / 2 - pad * 2;
    const halfH = canvas.height / 2 - pad * 2;
    const fitScale = Math.min(halfW / fitW, halfH / fitH);

    // Zwei Modi: 0 = ganze Karte ( Alles auf einen Blick),
    // 1 = NAH (2.4x, zentriert auf dich — folgt dir beim Laufen).
    state.mapZoomIdx = Number(localStorage.getItem('rlaus_mapZoom')) === 1 ? 1 : 0;
    const zoomed = state.mapZoomIdx === 1;
    let minX; let minY; let maxX = 0; let maxY = 0; let scale;
    if (zoomed && state.selfPos?.x != null) {
      const z = 2.4;
      scale = fitScale * z;
      const viewW = halfW / scale;
      const viewH = halfH / scale;
      minX = state.selfPos.x - viewW / 2;
      minY = state.selfPos.y - viewH / 2;
    } else {
      let pts = map.nodes.map((n) => [n.x, n.y]);
      // Eigener Pin zwingt die Karte nicht mehr ins Schrumpfen.
      if (state.selfPos?.x != null
        && state.selfPos.x >= fitMinX - fitW * 0.15 && state.selfPos.x <= fitMaxX + fitW * 0.15
        && state.selfPos.y >= fitMinY - fitH * 0.15 && state.selfPos.y <= fitMaxY + fitH * 0.15) {
        pts = [...pts, [state.selfPos.x, state.selfPos.y]];
      }
      minX = Math.min(...pts.map((p) => p[0]));
      maxX = Math.max(...pts.map((p) => p[0]));
      minY = Math.min(...pts.map((p) => p[1]));
      maxY = Math.max(...pts.map((p) => p[1]));
      const w = maxX - minX || 50;
      const h = maxY - minY || 50;
      scale = Math.min(halfW / w, halfH / h);
    }
    const clamped = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const toPx = (x, y) => {
      const [px, py] = [pad + (x - minX) * scale, pad + (y - minY) * scale];
      // Out-of-bounds (z.B. bist du vor map border): Pin bleibt am Rand.
      if (zoomed) {
        return [
          clamped(px, pad, canvas.width / 2 - pad),
          clamped(py, pad, canvas.height / 2 - pad),
        ];
      }
      return [px, py];
    };

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

    // Sabotage-Fixorte: rote pulsierende Badges zeigen, WO gefixt wird.
    const fixSpots = state.room?.sabotage?.fixSpots ?? [];
    for (const spot of fixSpots) {
      const [fx, fy] = toPx(spot.x, spot.y);
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
      ctx.fillStyle = `rgba(239,68,68,${0.3 + 0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(fx, fy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '15px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F6E0}\uFE0F', fx, fy + 5);
      ctx.textAlign = 'left';
    }

    // task markers: echte Server-Koordinaten (roomId/roomName/x/y);
    // \u00e4ltere Runden ohne Spots fallen auf Karten-Knoten zur\u00fcck.
    // Comms-Sabotage: Crew sieht keine Marker (Impostor schon).
    const eta = state.tasks ?? state.role?.tasks ?? [];
    const commsBlind = state.room?.sabotage?.type === 'COMMS' &&
      state.role?.role !== 'IMPOSTOR';
    const taskHits = [];
    // Mehrere Tasks im selben Raum: Marker leicht versetzt (kein Stack).
    const roomTaskSeen = {};
    let taskIdx = 0;
    for (const task of commsBlind ? [] : eta) {
      if (task.completed) continue;
      let tx, ty;
      if (task.x != null) {
        const perRoom = roomTaskSeen[task.roomId] ?? 0;
        roomTaskSeen[task.roomId] = perRoom + 1;
        [tx, ty] = toPx(task.x, task.y);
        tx += (perRoom % 2 === 0 ? -1 : 1) * Math.floor(perRoom / 2 + 1) * 13;
        ty -= Math.floor(perRoom / 2) * 6;
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
      const icon = TASK_ICONS[task.type] ?? '\u{1F4DD}';
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
      ctx.fillStyle = `rgba(255,209,102,${0.35 + 0.25 * pulse})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(icon, tx, ty + 4.5);
      ctx.textAlign = 'left';
      taskHits.push({ x: tx, y: ty, task });
    }
    state._taskHits = taskHits;

    // Kein eigener Fix: deutlicher Hinweis mitten auf der Karte.
    if (!state.selfPos?.x && !commsBlind) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(t('map.waiting'), canvas.width / 2, 30);
      ctx.textAlign = 'left';
    }

    // Bots (nur virtuelle Bewohner): hellblaue Pinguin-Dots mit Namen.
    if (showBotsEnabled()) {
      const groups = [state.botPositions?.crew, state.botPositions?.impostor];
      for (const list of groups) {
        for (const bot of list ?? []) {
          if (bot.x == null) continue;
          const [bx, by] = toPx(bot.x, bot.y);
          ctx.fillStyle = 'rgba(147, 197, 253, 0.9)';
          ctx.beginPath();
          ctx.arc(bx, by, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '600 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(bot.name ?? 'Bot', bx, by - 12);
          ctx.textAlign = 'left';
        }
      }
    }

    // corpses the player has discovered
    for (const body of state.nearbyBodies ?? []) {
      const [bx, by] = toPx(body.x, body.y);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // self marker: kräftiger "Du bist hier"-Pin, weich interpoliert
    if (state.selfPos?.x != null) {
      const smooth = (state._smoothPos ??= { x: state.selfPos.x, y: state.selfPos.y });
      smooth.x += (state.selfPos.x - smooth.x) * 0.55;
      smooth.y += (state.selfPos.y - smooth.y) * 0.55;
      const [sx, sy] = toPx(smooth.x, smooth.y);
      const turn = (Date.now() % 1600) / 1600; // weiche Puls-Welle
      ctx.fillStyle = `rgba(74,222,128,${0.5 + 0.3 * Math.sin(turn * Math.PI)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 16 + 6 * turn, 0, Math.PI * 2);
      ctx.fill();
      // Kompass-Fallback: wenn GPS selbst beim Gehen keine Richtung
      // liefert, zeigt der Pfeil die Handy-Ausrichtung vom Sensor.
      const heading = state.gpsHeading ?? (state.sensorMoving
        ? state.sensorHeading : null);
      if (typeof heading === 'number' && !Number.isNaN(heading)) {
        // Geo-Grade: 0 = Norden (oben auf der Karte), 90 = Osten (rechts).
        const rad = (heading * Math.PI) / 180;
        const dx = sx + Math.sin(rad) * 24;
        const dy = sy - Math.cos(rad) * 24;
        ctx.strokeStyle = '#86efac';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(dx, dy);
        ctx.stroke();
      }
      // Genauigkeits-Kreis: nur zeigen, wenn GPS ehrlich ungenau ist
      // (>8m)... mit Label, damit man weiß was der Kreis bedeutet.
      const accM = state.gpsAccM;
      if (accM && accM > 8) {
        const rPx = accM * scale;
        if (rPx > 6 && rPx < 200) {
          ctx.fillStyle = 'rgba(157, 243, 255, 0.10)';
          ctx.strokeStyle = 'rgba(157, 243, 255, 0.45)';
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(157, 243, 255, 0.9)';
          ctx.font = '600 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`\u00b1${Math.round(accM)}m`, sx, sy - rPx - 4);
          ctx.textAlign = 'left';
        }
      }
      ctx.fillStyle = '#4ade80';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('DU', sx, sy - 16);
      ctx.textAlign = 'left';
    }

    // Lights-Sabotage: Crew sieht fast nichts (Sommerfolientausch ~0.72 Deckkraft).
    const lightsOut = state.room?.sabotage?.type === 'LIGHTS' &&
      state.role?.role !== 'IMPOSTOR';
    if (lightsOut) {
      ctx.fillStyle = 'rgba(2, 4, 10, 0.78)';
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.75)';
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F4A1} LICHTER AUS \u2014 find Electrical im Dunkeln!', w / 2, h / 2);
      ctx.textAlign = 'left';
    }
  }
  $('btn-map-zoom').addEventListener('click', () => {
    const next = (Number(localStorage.getItem('rlaus_mapZoom')) === 1) ? 0 : 1;
    localStorage.setItem('rlaus_mapZoom', String(next));
    beep(next ? 520 : 380);
    drawGameMap();
  });
  window.addEventListener('resize', () => drawGameMap());
  window.addEventListener('orientationchange', () => setTimeout(drawGameMap, 300));

  function renderPhaseHint(room) {
    if (!state.role) return;
    $('game-phase-hint').textContent = ''; // Lebenden-Count nur im Meeting
    // Raumcode oben links (war "——" weil nie gesetzt).
    $('game-code').textContent = state.code || '——';
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
    sfx('kill_knife');
    ensureSocket().emit('game:kill', { code: state.code, targetPlayerId: targets[0].playerId });
    $('btn-kill').disabled = true;
    const killLabel2 = $('btn-kill').querySelector('.icon-label');
    if (killLabel2) killLabel2.textContent = 'Kill';
  });

  $('btn-use').addEventListener('click', () => {
    const action = useAction();
    if (!action) return;
    const socket = ensureSocket();
    if (action.kind === 'FIX') {
      socket.emit('game:sabotage_fix', { code: state.code, panel: action.panel });
      vibrate(60);
    } else if (action.kind === 'TASK') {
      openTask(action.task);
    } else if (action.kind === 'EMERGENCY') {
      state._usedEmergency = true;
      socket.emit('game:emergency', { code: state.code });
      vibrate(60);
    }
  });

  $('btn-sabotage').addEventListener('click', () => {
    if (state.room?.sabotage) {
      if (state.room.sabotage.deadline == null) {
        showToast('Sabotage l\u00e4uft \u2014 Crew muss fixen oder du w\u00e4hlst beim n\u00e4chsten Cooldown neu.');
      }
      return;
    }
    openSabotageSelect();
    vibrate(60);
  });

  // Task-Marker antippen startet KEIN Minigame mehr (Divo-Regel:
  // Tasks nur physisch vor Ort über Use-Knopf / Taskliste ausführen).
  $('game-map').addEventListener('click', () => {});

  // ------------------------------------------------------ Setz-Punkt ---- //

  /** Mini-Karten-Kalibrierung: Tap Raum = dort stehe ich wirklich. */
  const calib = { points: null, selected: null };

  function currentGps() {
    if (!state.gpsFixAt || Date.now() - state.gpsFixAt > 20000) return null;
    return { lat: state.gpsFix.latitude, lon: state.gpsFix.longitude };
  }

  // ------------------------------------------------- 2-Punkt-Kalibrierung --- //
  // Divo: Einmal 2 Straßenecken abgehen — danach startet jedes Spiel mit
  // der Karte direkt am richtigen Ort. Pro Punkt: 5s GPS sampeln (Median
  // = kurzzeitige Störer fliegen raus) + auf der Karte dort hin tippen.
  const cal2 = { step: 'idle', p1: null, buffer: [], iv: null, fit: null };

  function cal2MapSource() {
    // Bevorzugt der Live-Stand vom Server (map:update hält room.map frisch),
    // sonst der Editor-Zwischenstand (Map-Setup vor dem ersten Update).
    const rm = state.room?.map;
    if (rm?.rooms?.length || rm?.nodes?.length) return rm;
    return { rooms: editor.rooms, nodes: editor.working?.nodes ?? [] };
  }

  function cal2Hide() {
    $('cal2-overlay').classList.add('hidden');
    clearInterval(cal2.iv);
    cal2.iv = null;
    cal2.step = 'idle';
  }

  function openCal2() {
    const mapData = cal2MapSource();
    if (!mapData?.rooms?.length && !mapData?.nodes?.length) {
      showToast('Zeichne erst etwas auf die Karte, dann kalibrieren.');
      return;
    }
    cal2.mapData = mapData;
    cal2.p1 = mapData.cal?.p1 ?? null;
    cal2.p2 = null;
    cal2.step = 'idle';
    cal2.buffer = [];
    $('cal2-overlay').classList.remove('hidden');
    cal2UpdateUi();
    cal2Draw();
    clearInterval(cal2.iv);
    cal2.iv = setInterval(cal2Draw, 700);
  }

  function cal2UpdateUi() {
    const gpsDa = !!currentGps();
    const steps = $('cal2-steps');
    const btn = $('btn-cal2-sample');
    const status = $('cal2-status');
    if (cal2.step === 'sampling') {
      status.textContent = `GPS wird gesampelt \u2026 ${Math.ceil(cal2.msLeft / 1000)}s \u2014 ruhig stehen!`;
      btn.disabled = true;
      btn.textContent = 'Sampelt \u2026';
      return;
    }
    if (!cal2.p1) {
      steps.textContent = 'Punkt A: geh zur ersten Ecke (stra\u00dfenklare Position).';
      status.textContent = gpsDa ? 'GPS da \u2714 \u2014 dr\u00fccke "Punkt A".'
        : 'Warte auf GPS \u2014 rausgehen!';
      btn.disabled = !gpsDa;
      btn.textContent = 'Punkt A sampeln';
      return;
    }
    if (cal2.step === 'pick') {
      steps.textContent = 'Punkt A steht \u2705 \u2014 jetzt die zweite Ecke (weit weg!).';
      status.textContent = 'Tippe auf der Karte DORT hin, wo du gerade stehst.';
      btn.disabled = true;
      btn.textContent = 'Karte tappen \u2026';
      return;
    }
    if (cal2.step === 'p2pick') {
      steps.textContent = 'Punkt B kommt: geh zur zweiten Ecke, dr\u00fccke den Knopf.';
      status.textContent = gpsDa ? 'GPS da \u2714 \u2014 dr\u00fccke "Punkt B".'
        : 'Warte auf GPS \u2014 rausgehen!';
      btn.disabled = !gpsDa;
      btn.textContent = 'Punkt B sampeln';
      return;
    }
    if (cal2.step === 'p2-map') {
      steps.textContent = 'Punkt A \u2705 \u2014 Punkt B: tippe auf der Karte, wo du stehst.';
      status.textContent = 'Tippe auf die zweite Ecke.';
      btn.disabled = true;
      btn.textContent = 'Karte tappen \u2026';
      return;
    }
    if (cal2.step === 'done') {
      steps.textContent = 'Kalibriert \u2705 \u2014 ab jetzt startet die Karte automatisch richtig.';
      status.textContent = 'Speichern \u2026';
      btn.disabled = true;
      btn.textContent = ' Gespeichert ';
      return;
    }
    steps.textContent = 'Neukalibrieren \u00fcberschreibt die gespeicherten Punkte.';
    status.textContent = gpsDa ? 'GPS da \u2714 \u2014 dr\u00fccke "Punkt A".'
      : 'Warte auf GPS \u2014 rausgehen!';
    btn.disabled = !gpsDa;
    btn.textContent = 'Punkt A sampeln';
  }

  function cal2Sample() {
    const gps = currentGps();
    if (!gps) {
      cal2UpdateUi();
      showToast('Kein GPS \u2014 raus ins Freie, dann wieder dr\u00fccken.');
      return;
    }
    cal2.step = 'sampling';
    cal2.buffer = [{ ...gps, acc: state.gpsFix?.accuracy ?? 30 }];
    cal2.msLeft = 5000;
    cal2UpdateUi();
    cal2Draw();
    clearInterval(cal2.iv);
    cal2.iv = setInterval(() => {
      cal2.msLeft -= 400;
      const nowGps = currentGps();
      if (nowGps) cal2.buffer.push({ ...nowGps, acc: state.gpsFix?.accuracy ?? 30 });
      if (cal2.msLeft <= 0) {
        clearInterval(cal2.iv);
        // Median-Lat/Lon: kurze Fehl-Fixe (Autobus-Ghost) fliegen raus.
        const lats = cal2.buffer.map((p) => p.lat).sort((a, b) => a - b);
        const lons = cal2.buffer.map((p) => p.lon).sort((a, b) => a - b);
        const mid = Math.floor(lats.length / 2);
        cal2.median = { lat: lats[mid], lon: lons[mid] ?? lons[lons.length - 1] };
        cal2.step = cal2.p1 ? 'p2-map' : 'pick';
        cal2UpdateUi();
        cal2Draw();
        beep(760);
      } else {
        cal2UpdateUi();
      }
    }, 400);
  }

  function cal2PickPoint(px, py) {
    if (cal2.step !== 'pick' && cal2.step !== 'p2-map') return;
    const fit = cal2.fit;
    if (!fit) return;
    const point = fit.pointFromPx(px, py);
    point.lat = cal2.median.lat;
    point.lon = cal2.median.lon;
    if (cal2.step === 'pick') {
      cal2.p1 = point;
      cal2.step = 'p2pick';
    } else {
      const p1 = cal2.p1;
      const p2 = point;
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 5
        || Math.hypot(p2.lat - p1.lat, p2.lon - p1.lon) < 0.00005) {
        showToast('Punkte sind zu dicht beieinander \u2014 nimm zwei weit entfernte Ecken.');
        return;
      }
      ensureSocket().emit('map:cal', {
        code: state.code,
        cal: { p1, p2 },
      });
      cal2.p2 = p2;
      cal2.step = 'done';
      state.posSmooth = null;
      state.gpsTrail = [];
      state.velEst = null;
      state.projKey = null;
      state.proj = null;
      showToast('\ud83d\udcdb Kalibrierung gespeichert \u2014 gilt f\u00fcr immer (auch am Geburtstag).');
      setTimeout(() => cal2Hide(), 1200);
    }
    cal2UpdateUi();
    cal2Draw();
  }

  function cal2Draw() {
    if ($('cal2-overlay').classList.contains('hidden')) return;
    const info = $('cal2-map');
    const mapData = cal2.mapData ?? cal2MapSource();
    cal2.mapData = mapData;
    const pts = [
      ...((mapData.rooms ?? []).flatMap((r) => (r.polygon ?? []))),
      ...(mapData.nodes ?? []),
    ];
    if (cal2.step === 'idle' && currentGps()) cal2UpdateUi();
    if (!pts.length || !info) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = maxX - minX || 10;
    const h = maxY - minY || 10;
    const pad = 18;
    const scale = Math.min(
      (info.clientWidth - pad * 2) / w,
      (info.clientHeight - pad * 2) / h,
    );
    const fit = {
      pointFromPx(px, py) {
        const dispW = info.clientWidth;
        const dispH = info.clientHeight;
        const ox = (dispW - (w * scale)) / 2;
        const oy = (dispH - (h * scale)) / 2;
        return {
          x: minX + (px - ox) / scale,
          y: minY + (py - oy) / scale,
        };
      },
    };
    cal2.fit = fit;
    info.width = info.clientWidth * 2;
    info.height = info.clientHeight * 2;
    const ctx = info.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, info.clientWidth, info.clientHeight);
    const toPx = (x, y) => [
      (info.clientWidth - w * scale) / 2 + (x - minX) * scale,
      (info.clientHeight - h * scale) / 2 + (y - minY) * scale,
    ];
    // Straßen (Korridore) + Räume+Raum-Labels minimal zeichnen.
    ctx.strokeStyle = 'rgba(189, 207, 224, 0.5)';
    ctx.lineWidth = Math.max(2, 5 * scale);
    for (const corridor of mapData.corridors ?? []) {
      const ptsC = corridor.points ?? [];
      if (ptsC.length < 2) continue;
      ctx.beginPath();
      ptsC.forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
    for (const r of mapData.rooms ?? []) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      ctx.beginPath();
      poly.forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,209,102,0.14)';
      ctx.strokeStyle = 'rgba(255,209,102,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fill();
      if (r.name) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '600 10px system-ui';
        ctx.textAlign = 'center';
        const [cx2, cy2] = toPx(
          poly.reduce((s2, p) => s2 + p.x, 0) / poly.length,
          poly.reduce((s2, p) => s2 + p.y, 0) / poly.length,
        );
        ctx.fillText(r.name, cx2, cy2);
      }
    }
    // GPS-Puls: mit der bisherigen Kalibrierung kann GPS zurück auf die
    // Karte gerechnet werden (lebendiger Positionsmarkierer).
    const gpsUni = currentGps();
    let pulseProjection = null;
    if (gpsUni && cal2.p1) {
      const p2 = mapData.cal?.p2 ?? cal2.p2 ?? null;
      if (p2) {
        pulseProjection = twoPointProjector({ p1: cal2.p1, p2 });
      }
    }
    if (gpsUni && pulseProjection) {
      const [px, py] = toPx(...pulseProjection.project(gpsUni.lat, gpsUni.lon));
      const pulse = 5 + 3 * Math.sin(Date.now() / 300);
      ctx.beginPath();
      ctx.arc(px, py, pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96,165,250,0.85)';
      ctx.fill();
    }
    // Kalibrier-Punkte A/B einzeichnen:
    for (const [point, label] of [[cal2.p1, 'A'], [mapData.cal?.p2 ?? null, 'B']]) {
      if (!point) continue;
      const [pxDraw, pyDraw] = toPx(point.x, point.y);
      ctx.beginPath();
      ctx.arc(pxDraw, pyDraw, 7, 0, Math.PI * 2);
      ctx.fillStyle = label === 'A' ? '#4ade80' : '#f87171';
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 10px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pxDraw, pyDraw);
    }
    // Aktueller Schritt: frisch gesampelter Punkt hervorheben.
    if (cal2.step === 'pick' || cal2.step === 'p2-map') {
      ctx.fillStyle = 'rgba(96,165,250,0.9)';
      ctx.font = '600 11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Jetzt aufs Feld tippen!', info.clientWidth / 2, info.clientHeight - 6);
    }
  }

  function openCalibration() {
    const map = state.room?.map;
    if (!map?.rooms?.length) return;
    calib.points = map.rooms;
    calib.selected = null;
    $('btn-calib-here').textContent = 'Ich stehe hier';
    $('calib-overlay').classList.remove('hidden');
    clearInterval(drawCalibMap._iv);
    drawCalibMap();
    drawCalibMap._iv = setInterval(drawCalibMap, 700); // GPS-Puls & Status live
  }

  function drawCalibMap() {
    const canvas = $('calib-map');
    if (!canvas || calib.points == null) return;
    const pts = calib.points.flatMap((r) => (r.polygon ?? []));
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = maxX - minX || 10;
    const h = maxY - minY || 10;
    const pad = 18;
    const scale = Math.min(
      (canvas.clientWidth - pad * 2) / w,
      (canvas.clientHeight - pad * 2) / h,
    );
    const toPx = (x, y) => [
      pad + (x - minX) * scale,
      pad + (y - minY) * scale,
    ];
    canvas.width = canvas.clientWidth * 2;
    canvas.height = canvas.clientHeight * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    for (const r of calib.points) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      ctx.beginPath();
      poly.forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      const hit = calib.selected === r;
      ctx.fillStyle = hit ? 'rgba(74,222,128,0.35)' : 'rgba(255,209,102,0.14)';
      ctx.strokeStyle = hit ? '#4ade80' : 'rgba(255,209,102,0.6)';
      ctx.lineWidth = hit ? 3 : 1.5;
      ctx.stroke();
      ctx.fill();
      if (r.name) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '600 10px system-ui';
        ctx.textAlign = 'center';
        const [cx, cy] = toPx(
          poly.reduce((s, p) => s + p.x, 0) / poly.length,
          poly.reduce((s, p) => s + p.y, 0) / poly.length,
        );
        ctx.fillText(r.name, cx, cy);
      }
    }
    // Fingerprint: aktueller GPS-Puls zeigt, WO der Fix denkt, dass du bist.
    $('calib-status').textContent = currentGps()
      ? '\u00b1 GPS fix da. Tippe den Raum, in dem du stehst.'
      : 'Kein GPS-Signal — nach drau\u00dfen gehen!';
    $('btn-calib-here').disabled = !(calib.selected && currentGps());
  }

  function applyAnchorFrom(gpsFix, chosenPoint) {
    // anchor = GPS-Koordinaten, deren Projektion (0,0) genau der
    // gew\u00e4hlte Kartenpunkt ist. Equirectangular-Grobfahrung:
    const metersPerDeg = 111_320;
    const cosLat = Math.cos((gpsFix.lat * Math.PI) / 180);
    const lat0 = gpsFix.lat - chosenPoint.y / metersPerDeg;
    const lon0 = gpsFix.lon - chosenPoint.x / (metersPerDeg * Math.max(0.2, cosLat));
    return { lat: lat0, lon: lon0 };
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('#btn-cal2-close')) {
      cal2Hide();
      return;
    }
    if (event.target.closest('#btn-cal2-sample')) {
      cal2Sample();
      return;
    }
    if (event.target.closest('#btn-map-calib')) {
      openCal2();
      return;
    }
  });
  $('cal2-map').addEventListener('click', (event) => {
    const rect = event.target.getBoundingClientRect();
    cal2PickPoint(event.clientX - rect.left, event.clientY - rect.top);
  });

  // ---- Alter Einzel-Punkt-Flow (Fallback, verwaist) -------------------- //
  document.addEventListener('click', (event) => {
    if (event.target.closest('#btn-set-anchor')) {
      openCal2();
      return;
    }
    if (!event.target.closest('#btn-calib-here')) return;
    const gpsFix = currentGps();
    if (!gpsFix) {
      showToast('Kein GPS-Signal! Geh raus und warte, dann wieder dr\u00fccken.');
      return;
    }
    const chosen = calib.selected;
    if (!chosen) return;
    const poly = chosen.polygon ?? [];
    const cxy = {
      x: poly.reduce((s, p) => s + p.x, 0) / Math.max(1, poly.length),
      y: poly.reduce((s, p) => s + p.y, 0) / Math.max(1, poly.length),
    };
    ensureSocket().emit('map:anchor', {
      code: state.code,
      anchor: applyAnchorFrom(gpsFix, cxy),
    });
    // Neuer Ursprung -> alte Welt-Koordinaten sind serializer Unfug.
    state.posSmooth = null;
    $('calib-overlay').classList.add('hidden');
    clearInterval(drawCalibMap._iv);
    showToast('\ud83d\udcdb Setz-Punkt gespeichert \u2014 dein Marker erscheint mit dem n\u00e4chsten GPS-Fix.');
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#btn-calib-close')) {
      $('calib-overlay').classList.add('hidden');
      clearInterval(drawCalibMap._iv);
    }
  });
  $('calib-map').addEventListener('click', (event) => {
    if (!calib.points) return;
    const rect = event.target.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    // R\u00e4ume f\u00fcr den Tap in Pixel \u00fcbertragen:
    const pts = calib.points.flatMap((r) => (r.polygon ?? []));
    if (!pts.length) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = maxX - minX || 10;
    const h = maxY - minY || 10;
    const pad = 18;
    const scale = Math.min(
      (rect.width - pad * 2) / w,
      (rect.height - pad * 2) / h,
    );
    const toPx = (x, y) => [pad + (x - minX) * scale, pad + (y - minY) * scale];
    let best = null;
    let bestDist = Infinity;
    for (const r of calib.points) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      const [cx, cy] = toPx(
        poly.reduce((s, p) => s + p.x, 0) / poly.length,
        poly.reduce((s, p) => s + p.y, 0) / poly.length,
      );
      const d = Math.hypot(cx - px, cy - py);
      if (d < bestDist) { bestDist = d; best = r; }
    }
    if (best) {
      calib.selected = best;
      drawCalibMap();
      $('btn-calib-here').textContent = `Ich stehe hier: ${best.type}`;
    }
  });

  // Anker automatisch wiederherstellen, wenn die Karte deine Location
  // kennt (lokal gecachte Karte = exakt dieselben Roads wie im Spiel).
  function tryRestoreAnchor(room) {
    // Nur der Host darf den Ursprung setzen, und nur in den Phasen,
    // die der Server akzeptiert (MAP_READY/IN_GAME). Alles andere gibt
    // MAP_LOCKED -> wir wuerden das Fehler-Log fluten wie heute gesehen.
    if (!state.isHost) return;
    if (!['MAP_READY', 'IN_GAME'].includes(room?.status)) return;
    // Kalibrierte Karte: 2-Punkt-Projektor reicht vollständig aus.
    if (room.map?.cal?.p1 && room.map?.cal?.p2) return;
    if (state.anchorRestoreTried) return;
    if (!room?.map?.nodes?.length) return;
    if (Number.isFinite(room.map.anchor?.lat)) return;
    const cached = readSavedLocalMap();
    if (!cached?.nodes || cached.nodes.length !== room.map.nodes.length) return;
    const keyOf = (nodes) => nodes.map((n) => `${n.id}:${Math.round(n.x)}:${Math.round(n.y)}`).join('|');
    if (keyOf(cached.nodes) === keyOf(room.map.nodes) && Number.isFinite(cached.anchor?.lat)) {
      state.anchorRestoreTried = true;
      ensureSocket().emit('map:anchor', {
        code: state.code,
        anchor: cached.anchor,
      });
      showToast('\ud83d\udcdb GPS-Ursprung aus deiner gespeicherten Karte wiederhergestellt.');
    }
  }

  /** Zahnrad: Kalibrieren-Button für den Host in jeder Map-Phase. */
  function refreshAnchorUi() {
    const room = state.room;
    const showBtn = !!room?.map && state.isHost
      && ['MAP_SETUP', 'MAP_READY', 'IN_GAME'].includes(room.status);
    $('btn-set-anchor').classList.toggle('hidden', !showBtn);
    const hint = $('anchor-hint');
    hint.classList.toggle('hidden', !showBtn);
    hint.textContent = room?.map?.cal
      ? '\u2705 Karte kalibriert — der Button dient nur noch als Feintuning.'
      : 'Kalibriere ein Mal: 2 klare Punkte (z. B. Stra\u00dfenecken) abgehen, die App merkt sich das f\u00fcr immer.';
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#btn-set-anchor')) return;
    openCal2();
  });

  // EinstellungsMenü: DELEGATION auf Dokumentebene, damit der Zahnrad-
  // Button in keinem Fall verdeckt/blockiert sein kann (IRL-Bugfix).
  document.addEventListener('click', (event) => {
    const target = event.target.closest(
      '#btn-settings, #btn-lobby-settings, #btn-map-settings, #btn-settings-close, #btn-leave-from-menu',
    );
    if (!target) return;
    if (target.id === 'btn-settings'
      || target.id === 'btn-lobby-settings'
      || target.id === 'btn-map-settings') {
      $('opt-sound').checked = optEnabled('rlaus_sound', true);
      $('opt-vibration').checked = optEnabled('rlaus_vibration', true);
      $('opt-show-bots').checked = optEnabled('rlaus_showBots', true);
      $('opt-sfx-vol').value = Math.round(sfxVolumeBase() * 100);
      $('opt-lang').value = langActive();
      refreshAnchorUi();
      showErrorLogUi();
      // Divo-Regeln: Das Regeln-Panel im ⚙ existiert NUR für den Host —
      // andere Spieler sehen es gar nicht. Mid-game sichtbar, aber
      // eingefroren (Server wirft eh CONFIG_LOCKED).
      $('host-settings').classList.add('hidden');
      const cfgEditable = state.isHost && state.room
        && (state.room.status === 'LOBBY' || state.room.status === 'MAP_READY');
      if (state.isHost && state.room) {
        $('host-settings').classList.remove('hidden');
        $('host-settings').querySelector('summary').textContent = cfgEditable
          ? '\u2699\uFE0E Regeln einstellen (nur Host)'
          : '\u2699\uFE0E Regeln — in der Runde gesperrt';
        document.querySelectorAll('#host-settings select, #host-settings input')
          .forEach((el) => { el.disabled = !cfgEditable; });
        const applyBtn = $('cfg-apply');
        applyBtn.disabled = !cfgEditable;
        applyBtn.textContent = cfgEditable ? 'Speichern' : 'Gilt ab der n\u00e4chsten Runde';
        applyLobbyConfig(state.room);
      }
      $('settings-menu').classList.remove('hidden');
    } else if (target.id === 'btn-settings-close') {
      $('settings-menu').classList.add('hidden');
    } else if (target.id === 'btn-leave-from-menu') {
      $('settings-menu').classList.add('hidden');
      state.role = null;
      state.teammates = [];
      state.socket?.disconnect();
      state.socket = null;
      state.room = null;
      state.selfPos = null;
      state.posSmooth = null;
      state.botPositions = null;
      localStorage.removeItem('rlaus_session');
      show('home');
    }
  });
  document.addEventListener('change', (event) => {
    const id = event.target.id;
    if (id === 'opt-sound') {
      localStorage.setItem('rlaus_sound', event.target.checked ? '1' : '0');
    } else if (id === 'opt-sfx-vol') {
      localStorage.setItem('rlaus_sfx_vol', String(Number(event.target.value) / 100));
      // Losgelassen -> ein Preview-Beep, damit man die Lautstaerke hoert.
      sfx('task_done');
    } else if (id === 'opt-vibration') {
      localStorage.setItem('rlaus_vibration', event.target.checked ? '1' : '0');
    } else if (id === 'opt-show-bots') {
      localStorage.setItem('rlaus_showBots', event.target.checked ? '1' : '0');
      drawGameMap();
    } else if (id === 'opt-lang') {
      setLang(event.target.value);
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'opt-sfx-vol') {
      localStorage.setItem('rlaus_sfx_vol', String(Number(event.target.value) / 100));
    }
  });

  $('btn-rematch').addEventListener('click', () => {
    ensureSocket().emit('game:reset', { code: state.code });
    hideOverlaysNot();
    show('lobby');
  });

  // ------------------------------------------------------------- meeting //

  function renderMeeting({ phase, reporterId, discussionDeadline }) {
    // Report -> Todes-Entdeckungs-Sting; Notknopf -> berühmte Hupe.
    if (reporterId != null) sfx('report_body');
    else sfx('emergency_alarm');
    $('gameover-overlay').classList.add('hidden');
    $('eject-overlay').classList.add('hidden');
    $('meeting-overlay').classList.remove('hidden');
    state.voted = false;
    $('vote-reveal-bar').classList.add('hidden');
    $('vote-countdown').textContent = '';
    $('meeting-title').textContent = phase === 'DISCUSSION' ? t('meeting.title') : t('meeting.voteTitle');
    const players0 = state.room?.players ?? [];
    const stillAlive0 = players0.filter((p) => p.isAlive).length;
    const reportText = reporterId === state.playerId
      ? 'Du hast gemeldet!'
      : `Jemand hat gemeldet \u2014 ${deadlineText(discussionDeadline)}`;
    $('meeting-hint').textContent = `${reportText} \u2014 ${t('game.alive')} ${stillAlive0}`;
    const players = state.room?.players ?? [];
    // Diskussion: Warten, NICHT voten (sonst VOTING_NOT_OPEN-Log-Flood).
    if (phase === 'DISCUSSION') {
      openVoteList(players, null, 'Diskussion \u2014 Voting startet gleich\u2026');
      return;
    }
    openVoteList(
      players,
      (targetId) => {
        ensureSocket().emit('game:vote_cast', { code: state.code, targetId });
        state.voted = true;
        state.myVoteAt = Date.now();
        sfx('vote_locked');
        setVotedHint();
      },
      'Auf wen abstimmst du?',
    );
  }

  function setVotedHint() {
    $('meeting-hint').textContent = 'Stimme abgegeben \u2014 warte auf die anderen\u2026';
  }

  let voteCountdownTimer = null;
  function startVoteCountdown(deadline) {
    window.clearInterval(voteCountdownTimer);
    const el = $('vote-countdown');
    if (!deadline) { el.textContent = ''; return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      el.textContent = `Ends in: ${left}s`;
      if (left <= 0) window.clearInterval(voteCountdownTimer);
    };
    tick();
    voteCountdownTimer = window.setInterval(tick, 500);
  }

  /** Tablet-Karten (Farbchips) + optionaler Skip über das Bild im Header. */
  function openVoteList(candidates, onPick, title = 'Auf wen abstimmst du?') {
    const list = $('vote-list');
    list.innerHTML = '';
    $('meeting-hint').textContent = title;
    $('btn-skipvote').classList.toggle('hidden', !onPick || state.voted);
    for (const player of candidates) {
      const isMate = (state.teammates ?? []).some((m) => m.id === player.id);
      const isSelf = player.id === state.playerId;
      const li = document.createElement('li');
      li.className = 'vote-card';
      const dead = player.isAlive === false;
      if (dead) li.classList.add('dead');
      const chip = document.createElement('span');
      chip.className = 'vote-chip';
      chip.style.background = colorChipHex(player.colorId);
      li.appendChild(chip);
      const nameSpan = document.createElement('span');
      nameSpan.className = `vote-name${isMate ? ' imp-name' : ''}`;
      nameSpan.textContent = `${player.name}${isSelf ? ' (you)' : ''}`;
      li.appendChild(nameSpan);
      if (onPick && !dead && !state.voted) {
        li.classList.add('pickable');
        li.addEventListener('click', () => {
          onPick(player.id);
          list.querySelectorAll('.vote-card').forEach((c) => c.classList.remove('pickable'));
        });
      }
      list.appendChild(li);
    }
    if (!onPick) return; // Diskussion: kein Skip-Vote vor der Abstimmung.
  }

  $('btn-skipvote').addEventListener('click', () => {
    if (state.voted) return;
    ensureSocket().emit('game:vote_cast', { code: state.code, skip: true });
    state.voted = true;
    state.myVoteAt = Date.now();
    sfx('vote_locked');
    $('btn-skipvote').classList.add('hidden');
    setVotedHint();
  });

  // ------------------------------------------------------------ bootstrap //

  // Service-Worker for offline install (only on secure origins).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Auto-rejoin: NICHT mehr still einschleichen — das Original-Popup fragt
  // nach (Beim App-Öffnen zurück in die laufende Runde oder Lobby).
  if (localStorage.getItem('rlaus_session')) {
    const saved = JSON.parse(localStorage.getItem('rlaus_session') ?? 'null');
    if (saved?.code) {
      $('rejoin-text').textContent =
        `Du warst in der Runde ${saved.code}. Zur\u00fcck beitreten?`;
      $('rejoin-overlay').classList.remove('hidden');
    }
  }
  $('btn-rejoin-yes').addEventListener('click', () => {
    $('rejoin-overlay').classList.add('hidden');
    ensureSocket();
    ensureSocket().once('connect', () => tryRejoin());
  });
  $('btn-rejoin-no').addEventListener('click', () => {
    $('rejoin-overlay').classList.add('hidden');
    localStorage.removeItem('rlaus_session');
    showToast('Runde gelassen \u2014 du kannst sp\u00e4ter \u00fcber den Code joinen.');
  });

  return {
    screens,
    show,
    ensureSocket,
    getState: () => state,
  };
})();

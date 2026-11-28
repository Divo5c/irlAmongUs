/**
 * PWA app shell: start screen, lobby, map editor and the in-game HUD.
 * All server interaction runs through Socket.IO with the same event
 * protocol as the Flutter client. UI language: German.
 */
import { avatar, browserStorage, buttonArt, element, icon } from './ui.js';
import { langActive, localText, roomErrorText, roomLabel, t, taskStageLabel, taskTitle } from './i18n.js';
import { createSabotagePanel, reactorContainsPosition } from './sabotagePanels.js';
import { chooseUseAction } from './useAction.js';

const App = (() => {
  const $ = (id) => document.getElementById(id);
  const sabotagePanel = createSabotagePanel({
    t, tones: playTones, vibrate, notify: showToast,
    currentPanel: () => state.room?.sabotage?.panelStatus,
  });

  // ------------------------------------------------------- i18n (DE/EN) //
  /** Statische Texte im HTML tauschen (data-i18n Attribute). */
  function applyStaticI18n() {
    document.documentElement.lang = langActive();
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPh);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.querySelectorAll('#room-type-grid [data-room-type]').forEach((button) => {
      button.textContent = roomLabel(button.dataset.roomType);
    });
  }
  function setLang(lang) {
    browserStorage.setItem('rlaus_lang', lang === 'en' ? 'en' : 'de');
    applyStaticI18n();
    renderAdminSabotage();
    if (state.role) renderRole(state.role);
    if (state.room) renderLobbyPlayers(state.room);
    refreshCachedMapButton();
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
    canHost: false,
    name: '',
    playerId: '',
    token: '',
    code: '',
    isHost: false,
    room: null, // last public room snapshot
    sessionAttached: false,
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
    displayRoomName: roomLabel,
    onSelectionChanged: (count) => {
      $('btn-build-streets').disabled = count === 0;
      $('map-status').textContent = localText(`${count} Abschnitte ausgew\u00E4hlt`, `${count} sections selected`);
    },
    onRoomsChanged: (removed) => {
      // Rooms geaendert: direkt an den Server spiegeln (Lobby-Update folgt).
      ensureSocket().emit('map:update', {
        code: state.code,
        map: { ...editor.working, rooms: editor.rooms, connections: [] },
      });
      showToast(localText(`Raum "${removed?.name ?? '?'}" gel\u00f6scht (${editor.rooms.length} übrig).`, `Removed “${removed?.name ?? '?'}” (${editor.rooms.length} remaining).`));
      beep(300);
    },
  });

  // ------------------------------------------------------------- helpers //

  function show(name) {
    if (name !== 'game' && document.body.dataset.screen === 'game') closeGameDialogs();
    if (name === 'home') stopGpsWatchers();
    document.body.dataset.screen = name;
    if (name !== 'game') {
      clearGhostSkin();
      hideEmergencyPanel();
    }
  }

  let ghostHintTimer;

  function endGhostTransition() {
    screens.game.classList.remove('ghost-transition');
    document.removeEventListener('pointerdown', endGhostTransition, true);
  }

  function clearGhostSkin() {
    if (document.documentElement.dataset.role !== 'ghost') return;
    delete document.documentElement.dataset.role;
    endGhostTransition();
    window.clearTimeout(ghostHintTimer);
    $('ghost-status-hint').hidden = true;
  }

  function playGhostTransition() {
    if (document.body.dataset.screen !== 'game' || document.documentElement.dataset.role !== 'ghost') return;
    screens.game.classList.add('ghost-transition');
    document.addEventListener('pointerdown', endGhostTransition, { capture: true, once: true });
    if (state.room?.status !== 'IN_GAME' || !state.role) return;
    const hint = $('ghost-status-hint');
    hint.textContent = t(state.role.role === 'IMPOSTOR' ? 'ghost.impostorHint' : 'ghost.crewHint');
    hint.hidden = false;
    window.clearTimeout(ghostHintTimer);
    ghostHintTimer = window.setTimeout(() => { hint.hidden = true; }, 3600);
  }

  function activateGhostSkin(animate = false) {
    if (document.body.dataset.screen !== 'game' || document.documentElement.dataset.role === 'ghost') return;
    const self = state.room?.players?.find(({ id }) => id === state.playerId);
    const variant = [...state.playerId].reduce((sum, char) => sum + char.codePointAt(0), 0) % 2;
    $('ghost-atmosphere').dataset.variant = variant ? 'b' : 'a';
    $('ghost-status-avatar').replaceChildren(avatar(self?.colorId, true));
    document.documentElement.dataset.role = 'ghost';
    if (animate) playGhostTransition();
  }

  $('ghost-atmosphere').addEventListener('animationend', (event) => {
    if (event.target.classList.contains('ghost-cracks')) endGhostTransition();
  });

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
    const raw = browserStorage.getItem(key);
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
      const log = JSON.parse(browserStorage.getItem(ERROR_LOG_KEY) ?? '[]');
      log.push({
        at: new Date().toLocaleTimeString('de-DE'),
        kind,
        message: String(message).slice(0, 220),
        ...(stack ? { stack: String(stack).slice(0, 200) } : {}),
      });
      while (log.length > ERROR_LOG_MAX) log.shift();
      browserStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log));
    } catch (_) { /* log best-effort */ }
  }

  function renderErrorLogBox() {
    const box = $('error-log-box');
    if (!box) return;
    let log = [];
    try { log = JSON.parse(browserStorage.getItem(ERROR_LOG_KEY) ?? '[]'); } catch (_) {}
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
      const done = () => showToast(localText("Fehlerprotokoll kopiert.", "Error log copied."));
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
      browserStorage.removeItem(ERROR_LOG_KEY);
      renderErrorLogBox();
      showToast(localText("Fehlerprotokoll gelöscht.", "Error log cleared."));
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
      chip.textContent = localText(`App-Fehler: ${(error?.message ?? String(error)).slice(0, 110)}`, `App error: ${(error?.message ?? String(error)).slice(0, 110)}`) +
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

  let audioContext;
  const alertTones = {
    round_start: [330, 494, 659], task_done: [523, 784], report_body: [294, 220, 294],
    emergency_alarm: [392, 262, 392], sabotage_alarm: [220, 165, 220],
    victory_crew: [392, 523, 659], victory_impostor: [311, 233, 155],
    kill: [196, 123], kill_knife: [196, 123], vote_locked: [440, 587],
  };

  function sfxVolumeBase() {
    const savedVolume = Number(browserStorage.getItem('rlaus_sfx_vol') ?? 0.8);
    return Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 0.8;
  }

  function playTones(notes, milliseconds, volume) {
    if (!optEnabled('rlaus_sound', true) || audioContext?.state !== 'running') return;
    const level = sfxVolumeBase();
    const duration = milliseconds / 1000;
    notes.forEach((frequency, index) => {
      const start = audioContext.currentTime + index * duration;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level * volume * 0.12, start + 0.012);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    });
  }

  function beep(frequency = 660, milliseconds = 140) {
    playTones([frequency], milliseconds, 0.8);
  }

  function sfx(name, volume = 1) {
    const notes = alertTones[name] ?? [name === 'panel_close' ? 330 : 520];
    playTones(notes, notes.length > 1 ? 115 : 55, volume);
  }

  function unlockAudio() {
    const Audio = window.AudioContext ?? window.webkitAudioContext;
    if (!Audio || !optEnabled('rlaus_sound', true)) return;
    audioContext ??= new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  }

  document.addEventListener('pointerup', unlockAudio, { passive: true });
  document.addEventListener('keydown', unlockAudio);
  window.RlausSfx = sfx;

  // Menue/Lobby-Sound: JEDER Button-Druck gibt ein kurzes UI-Klick-Geräusch.
  document.addEventListener('pointerdown', (event) => {
    if (event.target?.closest?.('button')) sfx('ui_select', 0.5);
  }, true);

  // Room-Code erzeugt der Server (Anti-Squatting) — kein lokaler Generator mehr.

  // Boot in a game with ?code= parameter (deep share links)
  const bootUrlCode = new URL(location.href).searchParams.get('code');
  if (bootUrlCode && /^[A-Z2-9]{6}$/.test(bootUrlCode)) {
    const codeInput = $('join-code');
    if (codeInput) {
      codeInput.value = bootUrlCode.toUpperCase();
      setTimeout(() => codeInput.focus?.(), 400);
    }
  }

  function uuid() {
    return crypto.randomUUID?.() ?? `p${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  function ensureSocket() {
    if (state.socket) return state.socket;
    const socket = io();
    socket.on('room:updated', (room) => {
      const wasAlive = state.room?.code === room.code
        && state.room?.players?.some(({ id, isAlive }) => id === state.playerId && isAlive);
      if (state.room?.status === 'IN_GAME' && room.status !== 'IN_GAME') closeGameDialogs();
      state.room = room;
      renderAdminSabotage();
      sabotagePanel.sync(room.sabotage?.panelStatus,
        room.players?.some(({ id, isAlive }) => id === state.playerId && isAlive));
      renderPanelMapWarning();
      if (room.code) state.code = room.code;
      state.isHost = room.hostId === state.playerId;
      // Remember the lobby settings of this round on the device; a fresh
      // room later auto-applies them (Divo request).
      if (state.isHost && room.config) {
        try {
          browserStorage.setItem('rlaus.lastConfig', JSON.stringify(room.config));
        } catch { /* storage full/blocked: settings just don't persist */ }
      }
      renderLobbyPlayers(room);
      renderPhaseHint(room);
      // Meeting-Tafel live: "hat gevotet"-Hacken (Divo-Log 18).
      patchVotedBadges();
      // Regelkarte (nur Host) + Impostoren-Optionen aktuell halten.
      $('lobby-rules')?.classList.toggle('hidden', !(state.isHost
        && (room.status === 'LOBBY' || room.status === 'MAP_READY')));
      if (room.status === 'LOBBY' || room.status === 'MAP_READY') {
        updateImpostorOptions(room);
        applyLobbyConfig(room);
      }

      // Only auto-route when the user is not already in a deeper screen.
      const active = 'screen-' + document.body.dataset.screen;
      if (room.status === 'LOBBY' && active !== 'screen-lobby') {
        show('lobby');
      }
      if (room.status === 'GAME_OVER' || room.status === 'IN_GAME' || room.status === 'MEETING') {
        if (active !== 'screen-game') show('game');
        const self = room.players.find(({ id }) => id === state.playerId);
        if (self?.isAlive === false) activateGhostSkin(wasAlive && $('eject-overlay').classList.contains('hidden'));
        else if (self?.isAlive === true) clearGhostSkin();
      }
      // v19.15.1: Reconnect/Reload während eines laufenden Meetings —
      // game:meeting_started kommt nicht nochmal, also den Intro-Zustand
      // aus room:updated rekonstruieren. Alle landen im selben Schritt.
      if (room.status === 'MEETING' && !meetingIntroActive && !state.meetingIntroSynced) {
        state.meetingIntroSynced = true;
        if (room.meetingConfirmed === true || room.meetingPhase === 'VOTING') {
          // Bereits bestätigt oder schon im Voting -> direkt zur Tafel.
          renderMeeting({
            phase: room.meetingPhase,
            reporterId: room.reporterId ?? null,
            discussionDeadline: room.discussionDeadline ?? null,
          });
        } else {
          // Im Await (Host hat noch nicht bestätigt) -> Await-Schritt zeigen.
          startMeetingIntroLate();
        }
      }
      if (shouldSendPosition(room)) ensureGpsLoop();
      else stopGpsLoop();
      tryRestoreAnchor(room);
      rememberSavedMap(room);
      renderTeamProgress(room);
      if (meetingIntroActive && room.meetingConfirmed && room.meetingPhase === 'DISCUSSION') runMeetingReveal();
      else if (meetingIntroActive && meetingAwaitActive()) renderMeetingAwaitContent();
      drawGameMap();
      renderGameHud();
      renderSabotage();
      // MAP_READY: the host may go back to the lobby and start the game.
      const startGame = $('btn-start-game');
      const canStart = room.status === 'MAP_READY' && state.isHost;
      startGame.disabled = !canStart;
      if (room.status === 'MAP_READY') {
        startGame.textContent = t('lobby.start');
      } else if (state.isHost) {
        startGame.textContent = room.status === 'LOBBY' ? localText('Erst Karte laden', "Load the map first") : localText('Karte wird gebaut\u2026', "Preparing map…");
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
              connections: cached.connections ?? [],
              ...(cached.anchor ? { anchor: cached.anchor } : {}),
              ...(cached.cal ? { cal: cached.cal } : {}),
            },
          });
          ensureSocket().emit('map:save', {
            code: state.code,
            map: {
              version: cached.version + 2, nodes: cached.nodes,
              corridors: cached.corridors, rooms: cached.rooms ?? [],
              connections: cached.connections ?? [],
              ...(cached.anchor ? { anchor: cached.anchor } : {}),
              ...(cached.cal ? { cal: cached.cal } : {}),
            },
          });
          showToast(localText('Gespeicherte Karte \u00fcbernommen.', "Saved map loaded."));
        } else {
          showToast(localText('Keine gespeicherte Karte auf dem Ger\u00e4t \u2014 Stra\u00dfen laden.', "No saved map on this device. Load streets first."));
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
    socket.on('session:created', ({ code, playerId, token, canTriggerSabotage }) => {
      Object.assign(state, { code, playerId, token, canTriggerSabotage });
      renderAdminSabotage();
      state.sessionAttached = true;
      rememberSession();
    });
    socket.on('room:rejoined', (room) => {
      state.canTriggerSabotage = room.canTriggerSabotage;
      renderAdminSabotage();
      state.sessionAttached = true;
      rememberSession();
      if (['LOBBY', 'MAP_SETUP', 'MAP_READY'].includes(room.status)) {
        state.room = room;
        renderLobby(room);
        show('lobby');
      }
    });
    // The server only sends room:created to the host's own socket
    // (no broadcast), so it routes hosts into the lobby directly.
    socket.on('room:created', (room) => {
      state.room = room;
      state.code = room.code;
      state.isHost = room.hostId === state.playerId;
      state.autoMapReloaded = false;
      // Carry the lobby settings of the last round into the new room
      // (server clamps/validates everything again anyway).
      try {
        const lastConfig = JSON.parse(browserStorage.getItem('rlaus.lastConfig') ?? 'null');
        if (lastConfig) {
          ensureSocket().emit('game:update_config', {
            code: room.code,
            config: lastConfig,
          });
        }
      } catch { /* no stored settings: defaults apply */ }
      // Session (code/token) persists via session:created; code ins URL fürs Teilen.
      const url = new URL(location.href);
      url.searchParams.set('code', room.code);
      history.replaceState(null, '', url.toString());
      renderLobby(room);
      show('lobby');
    });
    socket.on('room:error', ({ code: errorCode, message, details }) => {
      // Server meldet teils englische Fachtexte — unten deutsche Klartexte.
      logAppError('server', `${errorCode}: ${message ?? ''}`);
      if (errorCode === 'HOST_DEVICE_REQUIRED') {
        state.canHost = false;
        $('btn-host').hidden = true;
        errorHome(localText('Dieser Browser ist fürs Erstellen von Lobbys noch nicht freigeschaltet.', "This browser is not authorized to create lobbies yet."));
        return;
      }
      if (errorCode === 'AUTH_FAILED') {
        // Session abgelaufen (z. B. Server-Restart): sauber raus statt
        // Position-Spam; GPS aus, Lobby zeigen.
        stopGpsLoop();
        state.room = null;
        state.selfPos = null;
        state.sessionAttached = false;
        browserStorage.removeItem('rlaus_session');
        show('home');
        errorHome(localText('Die Sitzung ist abgelaufen. Tritt mit einem gültigen Code erneut bei.', "The session expired. Rejoin with a valid code."));
        return;
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
        MAP_LOCKED: localText('Die Karte ist während der Runde gesperrt.', 'The map is locked during the round.'),
        MAP_MISSING: localText('Keine Karte im Spiel \u2014 Host muss erst eine speichern.', "The host needs to save a map before starting."),
        MAP_ANCHOR_INVALID: localText('Der Setz-Punkt war ung\u00fcltig \u2014 nochmal mit GPS-Signal versuchen.', "The reference point was invalid. Try again with a GPS fix."),
        CONFIG_INVALID: localText('Eine Regel hatte einen unm\u00f6glichen Wert \u2014 bitte neu einstellen.', "A game setting is invalid. Adjust it and try again."),
        INVALID_PHASE: localText('Das geht in dieser Spielphase nicht.', "This action is unavailable in the current phase."),
        NOT_IN_MEETING: t('meeting.await.expired'),
        NOT_ROOM_HOST: t('meeting.await.hostOnly'),
        POSITION_NOT_ALLOWED: null, // still \u2014 normal in Meetings
      }[errorCode];
      const text = friendly ?? roomErrorText(errorCode) ?? localText(
        `Aktion fehlgeschlagen (${errorCode ?? 'unbekannt'}).`,
        `Action failed (${errorCode ?? 'unknown'}).`,
      );
      if (text == null) return;
      if (document.body.dataset.screen === 'home') {
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
      state.killTargets = (targets ?? []).filter(({ playerId }) => !isImpostorPartner(playerId));
      renderGameHud();
    });
    socket.on('game:sabotage_started', () => {
      sfx('sabotage_alarm');
      vibrate([80, 60, 80, 60, 160]);
      renderSabotage();
    });
    socket.on('game:sabotage_panel_status', (status) => {
      const sab = state.room?.sabotage;
      if (sab?.panelStatus?.roundId !== status.roundId) return;
      sab.panelStatus = status;
      sabotagePanel.showStatus(status);
      renderSabotage();
    });
    socket.on('disconnect', () => {
      sabotagePanel.close();
      renderAdminSabotage();
    });
    socket.on('game:sabotage_fixed', () => {
      renderSabotage();
      showToast(langActive() === 'en' ? 'Sabotage repaired' : 'Sabotage repariert');
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
      state.panelPositionAt = performance.now();
      sabotagePanel.checkReactorReach((panelId) => {
        const spot = state.room?.sabotage?.fixSpots?.find(({ id }) => id === panelId);
        return spot && canReachSabotageSpot(spot);
      });
      if (meetingIntroActive && meetingAwaitActive()) renderMeetingAwaitContent();
      const wasRetrying = state.positionRetryAt > 0;
      state.positionRetryAt = 0;
      state.anchorOk = Boolean(pos.onCorridor || pos.roomId);
      // Zurück im Spielfeld -> Warnbanner ausblenden.
      if (state.anchorOk) {
        $('boundary-banner').classList.add('hidden');
      }
      if (wasRetrying) renderGpsStatus();
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
    socket.on('position:error', ({ code, message, details }) => {
      if (code === 'POSITION_NOT_ALLOWED') return; // Meeting etc. – ruhig ignorieren
      const retryAfterMs = details?.retryAfterMs;
      const delay = code === 'POSITION_UNREALISTIC'
        ? (Number.isFinite(retryAfterMs) ? Math.max(300, retryAfterMs) : 4250)
        : 3000;
      state.positionRetryAt = Date.now() + delay;
      state.posSmooth = null;
      state.gpsTrail = [];
      state.gpsPrevFix = null;
      state.velEst = null;
      state.lastSentPos = null;
      logAppError('position', `${code}: ${message ?? ''}`);
      renderGpsStatus();
    });
    socket.on('game:boundary_warning', ({ distanceM, limitM, escalationLevel }) => {
      const banner = $('boundary-banner');
      // Divo-Regelwerk: Stufe 1 = Countdown-Frist, Stufe 2 = ohne Frist
      // hart "Kehre sofort zurück!", Stufe 3 = Host wurde gealarmiert.
      banner.classList.toggle('escalate', (escalationLevel ?? 1) >= 2);
      if (escalationLevel >= 2) {
        banner.textContent = localText(`KEHRE SOFORT ZURÜCK! (±${Math.round(distanceM)}m)`, `RETURN NOW! (±${Math.round(distanceM)} m)`);
      } else {
        banner.textContent = localText(`Geh zurück ins Spielfeld! (${Math.round(distanceM)}m > ${Math.round(limitM)}m)`, `Back to the play area! (${Math.round(distanceM)} m > ${Math.round(limitM)} m)`);
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
      banner.textContent = localText(`ADMIN: ${name} ist ${Math.round(distanceM)}m draußen und WEIGERT sich!`, `HOST: ${name} is ${Math.round(distanceM)} m outside the play area.`);
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
      document.querySelectorAll('#vote-list .vote-card').forEach((row) => refreshVoteAffiliation(row));
      // Neue Runde = neuer Notfallknopf (Zähler lebt serverseitig).
      state._emergencyUsedThisRound = 0;
      sfx('round_start');
      showRoleOverlay(payload);
      ensureGpsLoop();
      vibrate([60, 60, 120]);
    });
    socket.on('game:kill_cooldown', ({ killReadyAt }) => {
      state.killReadyAt = killReadyAt;
    });
    // Getting this event means: SELF killed, or SELF is an impostor the
    // kill belonged to. Crewmates only learn about deaths via found bodies.
    socket.on('game:killed', ({ killedPlayerId }) => {
      sfx('kill');
      vibrate([200, 80, 200]);
      // Kill-Privacy (v19.13.5): room:updated kommt beim Kill NICHT mehr —
      // also setzt jedes empfangende Geraet das Opfer lokal auf tot,
      // sonst bleibt der Report-Button aktiv -> PLAYER_DEAD-Spam (Log 18).
      const victim = (state.room?.players ?? []).find(
        (player) => player.id === killedPlayerId,
      );
      if (victim) victim.isAlive = false;
      renderGameHud();
      if (killedPlayerId === state.playerId) {
        sabotagePanel.close();
        activateGhostSkin(true);
      } else {
        $('game-phase-hint').textContent = t('game.killLanded');
      }
    });
    // Admin table: server answers every poll with anonymous room counts.
    socket.on('game:admin_table_state', ({ blocked, counts }) => {
      if ($('admin-table')?.classList.contains('hidden')) return;
      state.adminTableLast = { blocked, counts: counts ?? {} };
      drawAdminTable();
    });
    socket.on('game:meeting_started', startMeetingIntro);
    // Host rematch or round abort: land everyone in the lobby screen.
    socket.on('game:reset_done', ({ aborted }) => {
      if (!aborted) return;
      state.role = null;
      state.tasks = [];
      closeAdminTable();
      endMeetingIntro();
      state.meetingIntroSynced = false; // v19.15.1: Meeting beendet, nächster Sync moeglich
      show('lobby');
      showToast(t('game.aborted'));
    });
    socket.on('game:voting_started', ({ votingDeadline }) => {
      state.votingDeadline = votingDeadline ?? 0;
      // Divo-Intro läuft noch (Host-Check dauert)? Voting ist da -> Intro
      // überspringen und sofort zur Abstimmung.
      if (meetingIntroActive) finalizeMeetingForVoting();
      else renderMeeting({ phase: 'VOTING', reporterId: state.room?.reporterId ?? null, votingDeadline });
      $('meeting-title').textContent = t('meeting.voteTitle');
      $('meeting-title').classList.add('pixel-title');
      // 10s-Bedenkklackern wie im Original (arbeitsspeicherfreundlich: 1
      // Timer). ISO-String parsen — string minus Zahl war NaN (Log 18).
      window.clearTimeout(state.votingWarnTimer);
      const votingEndsAtMs = typeof votingDeadline === 'string'
        ? new Date(votingDeadline).getTime()
        : votingDeadline;
      const warnIn = (votingEndsAtMs ?? 0) - 10000 - Date.now();
      if (state.room?.meeting?.phase === 'VOTING' && warnIn > 0 && state.voted !== true) {
        state.votingWarnTimer = window.setTimeout(() => sfx('vote_timer'), warnIn);
      }
    });
    socket.on('game:vote_reveal', ({ votes, anonymous }) => {
      sfx('panel_close');
      // v19.16: Voting Results Overlay statt nur der kleinen Bar.
      const overlay = $('vote-results-overlay');
      const title = $('vote-results-title');
      const list = $('vote-results-list');
      const proceeding = $('vote-results-proceeding');
      const isAnon = anonymous === true;
      title.textContent = t('meeting.results.title');
      proceeding.textContent = '';
      list.replaceChildren();
      overlay.classList.remove('hidden');
      $('meeting-overlay').classList.add('hidden');
      const skipLabel = t('meeting.results.skipped');
      if (isAnon || !votes?.length) {
        const label = isAnon ? t('meeting.results.anonymous') : skipLabel;
        const count = votes?.length || state.room?.votedIds?.length || 0;
        const row = element('li', 'vote-results-item anonymous');
        row.append(avatar('gray'), element('span', 'name', label), element('span', 'target', count));
        list.append(row);
      } else {
        for (const vote of votes) {
          const skipped = vote.targetId == null || vote.targetId === 'skip';
          const row = element('li', 'vote-results-item');
          row.append(
            avatar(vote.voterColorId),
            voteName(vote.voterId, vote.voterName ?? '?', 'name'),
            voteName(vote.targetId, skipped ? skipLabel : '→ ' + (vote.targetName ?? '?'), 'target'),
          );
          list.append(row);
        }
      }
      // Countdown 4.5s dann ausblenden.
      let remaining = 4500;
      const tick = () => {
        remaining -= 100;
        if (remaining <= 0) {
          window.clearInterval(voteResultsTimer);
          overlay.classList.add('hidden');
          proceeding.textContent = '';
        } else {
          proceeding.textContent = `${t('meeting.results.proceeding')}: ${Math.ceil(remaining / 1000)}s`;
        }
      };
      tick();
      window.clearInterval(voteResultsTimer);
      voteResultsTimer = window.setInterval(tick, 100);
    });
    socket.on('game:vote_progress', ({ votedCount, totalVoters }) => {
      // Eigene Stimme hat schon vote_locked -> nur für fremde klingeln.
      if (Date.now() - (state.myVoteAt ?? 0) > 1500) sfx('vote_cast', 0.6);
      $('meeting-hint').textContent = `${t('meeting.count')} ${votedCount}/${totalVoters}`;
      patchVotedBadges();
    });
    // Divo-Log 18: "ich hab nicht gesehen wen die bots gevotet haben" —
    // Among Us zeigt pro Spieler OEFFENTLICH, DASS er gevoted hat (grauer
    // Hacken an der Bohnenkarte). Ziel bleibt anonym (Server votedIds).
    function patchVotedBadges() {
      if ($('meeting-overlay').classList.contains('hidden')) return;
      const votedIds = state.room?.votedIds ?? [];
      if (!votedIds.length) return;
      for (const id of votedIds) {
        const card = [...$('vote-list').children].find((row) => row.dataset.playerId === id);
        if (!card || card.querySelector('.voted-chip')) continue;
        const chip = buttonArt('voted', t('meeting.votedBadge'));
        chip.classList.add('voted-chip');
        card.appendChild(chip);
      }
    }

    /** Nach der Eject-Show: Hinweise + GPS je nach Rundenstatus. */
    function applyEjectAftermath(ejectedPlayerId, ejectedPlayerName, status) {
      if (ejectedPlayerId === state.playerId) {
        playGhostTransition();
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
      // v19.16: Voting Results Overlay ausblenden falls noch laufend.
      $('vote-results-overlay').classList.add('hidden');
      window.clearInterval(voteResultsTimer);
      state.voted = false;
      const confirmEjects = state.room?.config?.confirmEjects !== false;
      // Eject-Sequenz: Weltraum + Bean im Spielerfarbton + Result-Text.
      const overlay = $('eject-overlay');
      const bean = $('eject-bean');
      const text = $('eject-text');
      const players = state.room?.players ?? [];
      const ejected = players.find((p) => p.id === ejectedPlayerId);
      bean.replaceChildren(...(ejected ? [avatar(ejected.colorId)] : []));
      // Animation neu starten (remove -> void offsetWidth -> add).
      bean.style.animation = 'none';
      void bean.offsetWidth;
      bean.style.animation = '';
      let ejectLine;
      if (ejectedPlayerId == null) {
        ejectLine = t('game.ejectedSkip');
      } else if (!confirmEjects) {
        const en = String(ejectedPlayerName ?? '?');
        ejectLine = t('eject.was').replace('{name}', en);
      } else {
        const en = String(ejectedPlayerName ?? '?');
        const line = ejectedRole === 'IMPOSTOR'
          ? t('eject.wasImp').replace('{name}', en)
          : t('eject.wasNotImp').replace('{name}', en);
        const remain = Number.isInteger(impostorsRemaining)
          ? t('eject.remain', { n: impostorsRemaining })
          : '';
        ejectLine = remain ? `${line}\n${remain}` : line;
      }
      text.textContent = ejectLine;
      $('meeting-overlay').classList.add('hidden');
      overlay.classList.remove('hidden');
      // Show the usual ejection result before the local ghost transition.
      if (ejectedPlayerId === state.playerId) activateGhostSkin();
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
      closeGameDialogs();
      endMeetingIntro();
      state.meetingIntroSynced = false; // v19.15.1: Meeting beendet, nächster Sync moeglich
      sfx(winner === 'CREWMATE' ? 'victory_crew' : 'victory_impostor');
      $('boundary-banner').classList.add('hidden');
      $('gameover-overlay').classList.remove('hidden');
      const goTitle = $('gameover-title');
      goTitle.textContent = langActive() === 'en'
        ? (winner === 'CREWMATE' ? 'Crew wins' : 'Impostor wins')
        : (winner === 'CREWMATE' ? 'Crew gewinnt' : 'Impostor gewinnt');
      goTitle.classList.add('pixel-title', 'gameover-title');
      goTitle.dataset.tone = winner === 'CREWMATE' ? 'crew' : 'imp';
      $('gameover-overlay').querySelector('.card')
        ?.setAttribute('data-win', winner === 'CREWMATE' ? 'crew' : 'imp');
      const reasonText = {
        TASKS_COMPLETE: localText('Alle Aufgaben sind erledigt.', "All tasks are complete."),
        IMPOSTORS_DEAD: localText('Kein Impostor mehr am Leben.', "No impostors are alive."),
        IMPOSTOR_PARITY: localText("Die Impostoren haben zur Crew aufgeschlossen.", "The impostors have caught up with the crew."),
        SABOTAGE_EXPIRED: localText('Die Zeit für die Reparatur ist abgelaufen.', "The repair timer expired."),
      }[reason];
      const progress = state.room?.taskProgress;
      const taskSummary = progress?.total ? progress.completed + '/' + progress.total + localText(' Aufgaben erledigt', " tasks completed") : '';
      $('gameover-detail').textContent = [reasonText, taskSummary].filter(Boolean).join(' · ');
      $('gameover-roster').replaceChildren(...(players ?? []).map((player) =>
        playerCard(player, player.role === 'IMPOSTOR' ? 'Impostor' : 'Crewmate')));
      $('btn-rematch').classList.toggle('hidden', !state.isHost);
      $('btn-gameover-lobby').classList.toggle('hidden', state.isHost);
    });
    socket.on('task:progress', ({ completedTaskId, advancedTaskId, stageIndex }) => {
      const ownList = state.role?.tasks ?? state.tasks ?? [];
      if (advancedTaskId) {
        // Stage abgehakt: naechste Stufe wird zum Ziel.
        const task = ownList.find((t) => t.id === advancedTaskId);
        if (task) {
          task.stageIndex = stageIndex ?? 1;
          const nextStage = task.stages?.[task.stageIndex];
          if (nextStage) {
            task.roomId = nextStage.roomId;
            task.roomName = nextStage.roomName;
            task.roomType = nextStage.roomType;
            task.x = nextStage.x;
            task.y = nextStage.y;
          }
          showToast(task.roomName
            ? localText(`Stufe erledigt. Nächstes Ziel: ${roomLabel(task.roomName)}.`, `Stage complete. Next location: ${roomLabel(task.roomName)}.`)
            : localText('Stufe erledigt.', 'Stage complete.'));
          const li = $('task-list').querySelector(`[data-task-id="${advancedTaskId}"] small`);
          if (li) li.textContent = taskLocationLabel(task);
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
        showToast(task?.isFake ? localText('Scheinaufgabe erledigt.', 'Fake task complete.') : t('toast.taskdone'));
        sfx('task_done');
        vibrate(50);
        const li = $('task-list').querySelector(`[data-task-id="${completedTaskId}"]`);
        if (li) {
          li.classList.add('done');
          li.querySelector('button').disabled = true;
          li.querySelector('svg').replaceWith(icon('check'));
        }
      }
      drawGameMap();
      renderGameHud();
    });
    socket.on('connect', () => connectionStatus());
    socket.on('connect_error', () => connectionStatus(localText('Verbindung verloren. Wir verbinden dich neu.', "Connection lost. Reconnecting…")));
    socket.on('disconnect', (reason) => {
      const wasAttached = state.sessionAttached;
      state.sessionAttached = false;
      if (reason === 'io client disconnect') return;
      connectionStatus(localText('Verbindung verloren. Wir verbinden dich neu.', "Connection lost. Reconnecting…"));
      if (!wasAttached) return;
      rememberSession();
      socket.once('connect', () => {
        if (tryRejoin()) return;
        stopGpsLoop();
        state.room = null;
        show('home');
      });
    });

    state.socket = socket;
    return socket;
  }

  function hideOverlaysNot() {
    $('gameover-overlay').classList.add('hidden');
  }

  function closeGameDialogs() {
    sabotagePanel.close();
    window.RlausTasks?.close();
    $('sabotage-picker')?.remove();
    $('settings-menu').classList.add('hidden');
    closeAdminTable();
    hideEmergencyPanel();
  }



  const SESSION_KEY = 'rlaus_session';
  const REJOIN_WINDOW_MS = 15 * 60 * 1000;

  function rememberSession() {
    const { code, playerId, token, name } = state;
    browserStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId, token, name, lastActiveAt: Date.now() }));
  }

  function isRecentSession(saved) {
    if (!Number.isFinite(saved.lastActiveAt)) return false;
    const age = Date.now() - saved.lastActiveAt;
    return age >= 0 && age <= REJOIN_WINDOW_MS;
  }

  function forgetSession(raw) {
    if (browserStorage.getItem(SESSION_KEY) === raw) browserStorage.removeItem(SESSION_KEY);
  }

  function recentSession() {
    const raw = browserStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch {
      forgetSession(raw);
      return null;
    }
    if (!saved || !/^[A-Z2-9]{6}$/.test(saved.code) || !saved.playerId || !saved.token || !isRecentSession(saved)) {
      forgetSession(raw);
      return null;
    }
    return { ...saved, raw };
  }

  async function checkSavedSession(saved) {
    if (!saved || !isRecentSession(saved) || browserStorage.getItem(SESSION_KEY) !== saved.raw) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/rooms/${saved.code}/rejoin-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: saved.playerId, token: saved.token }),
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 404) forgetSession(saved.raw);
      return response.status === 204 && isRecentSession(saved) && browserStorage.getItem(SESSION_KEY) === saved.raw;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function tryRejoin(saved = recentSession()) {
    if (!saved || !isRecentSession(saved) || browserStorage.getItem(SESSION_KEY) !== saved.raw) return false;
    state.name = saved.name ?? state.name;
    Object.assign(state, { code: saved.code, playerId: saved.playerId, token: saved.token });
    state.socket.emit('room:rejoin', { code: saved.code, playerId: saved.playerId, token: saved.token, sabotagePanels: true });
    return true;
  }

  // ---------------------------------------------------------------- home //

  async function refreshHostAccess() {
    const url = new URL(location.href);
    const activation = new URLSearchParams(url.hash.slice(1));
    const token = activation.get('host');
    if (activation.has('host')) {
      activation.delete('host');
      url.hash = activation.toString();
      history.replaceState(null, '', url);
    }
    try {
      if (token) {
        const response = await fetch('/host-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (response.status !== 204) errorHome(localText('Dieser Freischaltlink ist ungültig.', "This access link is invalid."));
      }
      const response = await fetch('/host-access', { cache: 'no-store' });
      state.canHost = response.ok && (await response.json()).canHost === true;
      $('btn-host').hidden = !state.canHost;
    } catch {
      if (token) errorHome(localText('Die Freischaltung ist gerade nicht erreichbar. Öffne den Link erneut, sobald du online bist.', "Access activation is unavailable. Open the link again when you are online."));
    }
  }

  async function joinRoom({ asHost }) {
    if (asHost && !state.canHost) return;
    const name = $('player-name').value.trim() || 'Spieler';
    state.name = name;
    state.canTriggerSabotage = false;
    renderAdminSabotage();
    browserStorage.setItem('rlaus_name', name);
    ensureSocket();

    if (asHost) {
      const playerId = uuid();
      state.playerId = playerId;
      state.socket.emit('room:create', {
        // Der Server vergibt den Code (Kollision + Bunny-Squatting auss).
        hostId: playerId,
        hostName: name,
        sabotagePanels: true,
      });
    } else {
      const code = $('join-code').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        errorHome(localText('Code hat 6 Zeichen (Buchstaben/Zahlen, ohne l/I/O/1).', "Lobby codes use six characters, excluding I, O and 1."));
        return;
      }
      state.playerId = uuid();
      state.socket.emit('room:join', {
        code,
        playerId: state.playerId,
        playerName: name,
        sabotagePanels: true,
      });
    }

    // The room:updated handler routes to the lobby automatically; nothing
    // else to do here.
  }

  $('player-name').value = browserStorage.getItem('rlaus_name') ?? '';
  $('btn-host').addEventListener('click', () => joinRoom({ asHost: true }));
  $('btn-join').addEventListener('click', () => joinRoom({ asHost: false }));
  $('btn-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.code); } catch (_) {}
    $('btn-share').textContent = localText('Kopiert!', "Copied!");
    setTimeout(() => ($('btn-share').textContent = t('home.copyCode')), 1200);
  });
  $('btn-bot-add').addEventListener('click', () => {
    ensureSocket().emit('game:bot_add', { code: state.code, count: 1 });
  });
  $('btn-bot-remove').addEventListener('click', () => {
    ensureSocket().emit('game:bot_remove', { code: state.code });
  });

  $('btn-leave').addEventListener('click', () => {
    browserStorage.removeItem('rlaus_session');
    state.socket?.disconnect();
    state.socket = null;
    state.room = null;
    show('home');
  });

  // --------------------------------------------------------------- lobby //

  function renderLobby(room) {
    const isHost = room.hostId === state.playerId;
    state.isHost = isHost;
    // GPS früh warm laufen lassen (Divo-Feldtest: beim Kalibrieren im
    // Map-Setup war der erste Fix noch nicht da — der Loop lief erst
    // mit der Rollen-Zuteilung im Spiel an).
    ensureGpsLoop();
    $('host-controls').classList.toggle('hidden', !isHost);
    // Divo (v19.13): die Spielregeln leben jetzt DIREKT in der Lobby —
    // kein Zahnrad-Umweg mehr. Gäste sehen die Karte nicht (nur Host).
    const rulesEditable = isHost
      && (room.status === 'LOBBY' || room.status === 'MAP_READY');
    $('lobby-rules').classList.toggle('hidden', !rulesEditable);
    applyLobbyConfig(room);
    updateImpostorOptions(room);
    $('lobby-waiting').classList.toggle('hidden', isHost);
    $('lobby-code').textContent = room.code;
    renderLobbyPlayers(room);
    refreshCachedMapButton();
    // Divo: after the v19.13.4 cal-carry, a fresh room now ALSO restores the
    // saved map WITHOUT pressing the "load map" button — host, empty room,
    // device cache present -> straight into MAP_SETUP + load + save.
    if (
      isHost
      && room.status === 'LOBBY'
      && !room.map
      && readSavedLocalMap()
      && !state.autoMapReloaded
    ) {
      state.autoMapReloaded = room.code;
      state.pendingCachedLoad = true;
      showToast(localText('Gespeicherte Karte wird automatisch geladen\u2026', "Loading saved map automatically…"));
      ensureSocket().emit('map:start', { code: room.code });
    }
  }

  function renderLobbyPlayers(room) {
    $('lobby-players').replaceChildren(...room.players.map((player) =>
      playerCard(player, player.id === room.hostId ? '★ Host' : player.isBot ? 'Bot' : localText('Bereit', "Ready"))));
  }

  function playerCard(player, label) {
    const card = element('li', 'player-card');
    card.append(
      avatar(player.colorId, player.isAlive === false),
      element('span', 'player-name', player.name),
      element('span', 'badge', label),
    );
    return card;
  }


  $('btn-edit-map').addEventListener('click', () => {
    if (!state.room) return;
    if (state.room.status !== 'LOBBY') {
      showToast(localText('Karte bearbeiten geht nur in der Lobby (Runde verlassen oder neu laden).', "You can edit the map from the lobby."));
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
      $('map-status').textContent = localText(`Karte geladen (${roomMap.nodes.length} Knoten) \u2014 erweitern oder speichern`, `Map loaded (${roomMap.nodes.length} points). Edit or save it.`);
    } else {
      editor.setRooms(state.room?.map?.rooms ?? []);
      // Cache-only: nach MAP_SETUP-ACK reinladen (map:update braucht den Status).
      state.autoCachedMap = !!readSavedLocalMap()?.nodes?.length;
      $('map-status').textContent = state.autoCachedMap ? localText('Lade gespeicherte Karte\u2026', "Loading saved map…") : localText('Position suchen\u2026', "Finding your location…");
    }
  });
  $('btn-map-back').addEventListener('click', () => show(state.room.status === 'MAP_READY' || state.room.status === 'MAP_SETUP' ? 'lobby' : 'home'));
  $('btn-start-game').addEventListener('click', () => {
    if (!state.room?.map) {
      alert(localText('Speichere zuerst eine Karte.', 'Save a map first.'));
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
      const map = JSON.parse(browserStorage.getItem(SAVED_MAP_KEY) ?? 'null');
      // Anchor may be missing from very old saves; loading still works,
      // GPS projection just needs a fresh anchor in that case.
      if (!Array.isArray(map?.nodes) || !map.nodes.length ||
          !map.nodes.every((node) => typeof node?.id === 'string' && Number.isFinite(node.x) && Number.isFinite(node.y)) ||
          !Array.isArray(map.corridors) || !map.corridors.length ||
          !map.corridors.every((corridor) => typeof corridor?.a === 'string' && typeof corridor.b === 'string') ||
          (map.rooms != null && (!Array.isArray(map.rooms) || !map.rooms.every((room) =>
            room && Array.isArray(room.polygon) && room.polygon.every((point) =>
              Number.isFinite(point?.x) && Number.isFinite(point?.y))))) ||
          (map.connections != null && !Array.isArray(map.connections))) return null;
      return map;
    } catch {
      return null;
    }
  }

  function sameMapNodes(a, b) {
    return a?.nodes?.length === b?.nodes?.length && a?.nodes?.every((node, index) => {
      const other = b.nodes[index];
      return node.id === other.id && node.x === other.x && node.y === other.y;
    });
  }

  function rememberSavedMap(room) {
    if (!state.isHost || !['MAP_READY', 'IN_GAME'].includes(room.status) || !room.map?.nodes?.length) return;
    if (state.savedMapSnapshot === room.map) return;
    state.savedMapSnapshot = room.map;
    const previous = readSavedLocalMap();
    const map = { ...room.map };
    if (sameMapNodes(previous, map)) {
      map.anchor ??= previous.anchor;
      map.cal ??= previous.cal;
    }
    const { savedAt, ...previousMap } = previous ?? {};
    if (JSON.stringify(map) === JSON.stringify(previousMap)) return;
    browserStorage.setItem(SAVED_MAP_KEY, JSON.stringify({ ...map, savedAt: new Date().toISOString() }));
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
    const date = new Date(cached.savedAt).toLocaleDateString(localText('de-DE', 'en-GB'));
    const label = localText(`⤓ Gespeicherte Karte laden (${cached.nodes.length} Punkte, ${date})`,
      `⤓ Load saved map (${cached.nodes.length} points, ${date})`);
    editorButton.hidden = false;
    editorButton.textContent = label;
    lobbyButton.hidden = false;
    lobbyButton.textContent = label;
  }

  /** Loads the device-local map into the editor and pushes it to the room. */
  function applyCachedMap() {
    const cached = readSavedLocalMap();
    if (!cached) return;
    if (Number.isFinite(cached.anchor?.lat) && Number.isFinite(cached.anchor?.lon)) {
      editor.setAnchor(cached.anchor.lat, cached.anchor.lon);
    } else {
      showToast(localText("Die Karte hat keinen GPS-Bezugspunkt. Dein Standort ist eventuell nicht verfügbar.", "This map has no GPS reference point. Location may be unavailable in the game."));
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
        localText(`Doppelte Räume entfernt. ${cachedRooms.length} Räume bleiben.`,
          `Removed duplicate rooms. ${cachedRooms.length} rooms remain.`),
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
      // KRITISCH: rooms MITRAUMEN — früher stand hier rooms: [] und der
      // Server löschte alle Räume (Millisekunden-Flash!).
      // v19.13.4: cal MIT-SCHICKEN — in einem NEUEN Raum hat room.map
      // noch keine Kalibrierung, der Server-Schutz kann nichts retten,
      // was im Payload fehlt.
      map: {
        ...working,
        rooms: editor.rooms,
        connections: cached.connections ?? [],
        ...(cached.anchor ? { anchor: cached.anchor } : {}),
        ...(cached.cal ? { cal: cached.cal } : {}),
      },
    });
    $('map-status').textContent = localText(`Gespeicherte Karte geladen (${working.nodes.length} Knoten) \u2014 erweitern oder speichern`, `Saved map loaded (${working.nodes.length} points). Edit or save it.`);
  }

  // Lobby shortcut: skips the editor entirely (map:start -> MAP_SETUP -> load+save).
  $('btn-load-cached-lobby').addEventListener('click', () => {
    state.pendingCachedLoad = true;
    ensureSocket().emit('map:start', { code: state.code });
    showToast(localText('Lade gespeicherte Karte\u2026', "Loading saved map…"));
  });

  $('btn-load-cached').addEventListener('click', () => {
    applyCachedMap();
  });

  $('btn-load-streets').addEventListener('click', async () => {
    if (!('geolocation' in navigator)) {
      $('map-status').textContent = localText('Kein GPS auf diesem Ger\u00e4t.', "Location services are unavailable on this device.");
      return;
    }
    $('btn-load-streets').disabled = true;
    $('map-spinner').classList.remove('hidden');
    $('map-status').textContent = localText('GPS-Fix wird gesucht\u2026', "Finding a GPS position…");
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        });
      });
      const { latitude, longitude } = position.coords;
      $('map-status').textContent = localText(`\u00b1${Math.round(position.coords.accuracy)}m Genauigkeit \u2014 Stra\u00DFen laden (dauert 10\u201340s, Bildschirm offen halten)\u2026`, `±${Math.round(position.coords.accuracy)} m accuracy. Loading streets (10–40 s)…`);
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
            ? localText('Straßen werden geladen. Bitte lass den Bildschirm an.', 'Loading streets. Keep your screen on.')
            : localText(`Versuch ${attempt}: Straßen werden erneut geladen …`, `Attempt ${attempt}: Retrying street download…`);
        try {
          streets = await OSM.fetchStreets(latitude, longitude, radius);
        } catch (error) {
          lastError = error;
          // Server rate-limits den Proxy pro IP (2s): sofortiges
          // Nochmal-Würfen würde alle Versuche in einer Millisekunde
          // verbrennen. Kurz abwarten und dann sauber wiederholen.
          if (/schnell/i.test(String(error?.message ?? error))) {
            await new Promise((resolve) => setTimeout(resolve, 2300));
          }
        }
      }
      if (!streets) throw lastError;
      const candidates = OSM.toCandidates(streets, { lat: latitude, lon: longitude });
      // Whole OSM ways are too long to select: split at real junctions so
      // tapping picks street blocks instead of an entire through street.
      const pieces = OSM.splitCandidatesAtJunctions(candidates);
      editor.setCandidates(pieces);
      $('map-status').textContent = localText(`${pieces.length} Abschnitte aus ${candidates.length} Stra\u00DFen geladen \u2014 antippen zum Ausw\u00e4hlen`, `Loaded ${pieces.length} sections from ${candidates.length} streets. Tap to select.`);
      if (!pieces.length) $('map-status').textContent = localText('Keine Stra\u00DFen gefunden \u2014 Radius erh\u00f6hen?', "No streets found. Try a larger radius.");
    } catch (error) {
      $('map-status').textContent = localText(`Fehler: ${error.message}`, `Error: ${error.message}`);
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
    $('map-status').textContent = localText(`${nodeCount} Knoten, ${corridorCount} Verbindungen \u2014 weiter antippen oder speichern`, `${nodeCount} points, ${corridorCount} corridors. Select more or save.`);
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
      showToast(localText('Raum braucht mindestens 3 Punkte.', "A room needs at least three points."));
      return;
    }
    const type = state.editorRoomType ?? 'CAFETERIA';
    const room = editor.commitRoom(ROOM_NAME_BY_TYPE[type] ?? type, type);
    if (!room) return;
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { ...editor.working, rooms: editor.rooms, connections: [] },
    });
    showToast(localText(`Raum „${room.name}“ angelegt (${editor.rooms.length} insgesamt).`, `Room “${room.name}” added (${editor.rooms.length} total).`));
    beep(880);
    $('room-type-picker').classList.add('hidden');
    $('btn-room-mode').classList.remove('primary');
    $('btn-room-mode').textContent = localText('Raum zeichnen', "Draw room");
  };

  $('room-type-grid').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-room-type]');
    if (!btn) return;
    state.editorRoomType = btn.dataset.roomType;
    highlightRoomType();
    showToast(localText(`Raum-Typ: ${roomLabel(state.editorRoomType)} — jetzt zeichnen.`, `Room type: ${roomLabel(state.editorRoomType)}. Draw its outline.`));
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
      ? localText('Raummodus beenden', 'Exit room drawing')
      : localText('Raum zeichnen', "Draw room");
    $('map-hint').textContent = editor.roomMode
      ? localText('Setze Eckpunkte und tippe zum Speichern erneut auf den ersten Punkt. Halte einen Raum gedrückt, um ihn zu löschen.',
        'Place the corners and tap the first point again to save. Press and hold a room to delete it.')
      : t('map.pickStreet');
  });

  $('btn-room-undo').addEventListener('click', () => editor.undoRoomPoint());

  $('btn-map-save').addEventListener('click', () => {
    const working = editor.working;
    if (!working.nodes.length) {
      $('map-status').textContent = localText("Die Karte ist leer. Lade zuerst Straßen und übernimm eine Auswahl.", "The map is empty. Load and select streets first.");
      return;
    }
    ensureSocket().emit('map:save', {
      code: state.code,
      map: { ...working, rooms: editor.rooms, connections: [], ...(editor.anchor ? { anchor: editor.anchor } : {}) },
    });
    alert(localText('Karte gespeichert. Du kannst die Runde in der Lobby starten.',
      'Map saved. You can start the round from the lobby.'));
    show('lobby');
  });

  $('btn-map-clear').addEventListener('click', () => {
    if (!confirm(localText('Alle Stra\u00DFen und Knoten l\u00f6schen?', "Remove all streets and points?"))) return;
    editor.clearWorking();
    editor.setRooms([]);
    ensureSocket().emit('map:update', {
      code: state.code,
      map: { version: 1, nodes: [], corridors: [], rooms: [], connections: [] },
    });
    $('map-status').textContent = localText('Karte entleert.', "Map cleared.");
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

  // Divo (v19.13.1): Spiel-Einstellungen wieder einklappbar — Beginn
  // zugeklappt wie frueher im Zahnrad, Zustand merkt sich pro Geraet.
  $('btn-rules-toggle')?.addEventListener('click', () => {
    const body = $('rules-body');
    if (!body) return;
    const button = $('btn-rules-toggle');
    const collapsed = !body.classList.contains('collapsed');
    body.classList.toggle('collapsed', collapsed);
    button?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    try {
      browserStorage.setItem('rlausRulesOpen', collapsed ? '0' : '1');
    } catch { /* private mode: toggle works without memory */ }
  });
  try {
    if (browserStorage.getItem('rlausRulesOpen') === '1') {
      $('rules-body')?.classList.remove('collapsed');
      $('btn-rules-toggle')?.setAttribute('aria-expanded', 'true');
    }
  } catch { /* private mode */ }

  // Divo (v19.13.4, Feldtest 3.11): "Regeln speichern"-Knopf ENTFERNT.
  // Jede Aenderung (select/checkbox)	sendet die komplette Einstellung
  // sofort — der Server broadcastet die Bestätigung zurueck; wenn Divo
  // dachte "es hat nicht geklappt", war es vermutlich ein verworfener Patch.
  const collectLobbyConfig = () => ({
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
  });
  $('lobby-rules').addEventListener('change', (event) => {
    if (!event.target.closest('select, input[type="checkbox"]')) return;
    ensureSocket().emit('game:update_config', {
      code: state.code,
      config: collectLobbyConfig(),
    });
    beep(660);
    const label = event.target.closest('label')?.querySelector('span')?.textContent;
    showToast(label ? localText(`Gespeichert: ${label}`, `Saved: ${label}`) : localText('Gespeichert', 'Saved'));
  });

  /**
   * Divo (v19.13): kompakte Impostoren-Wahl mit automatischer Ausgrauung.
   * Server-Formel (game/config.js): max = max(1, floor((Spieler-1)/2)).
   * Was nicht geht, ist disabled UND erklärt beim Antippen, WARUM.
   */
  function maxImpostorsForClient(playerCount) {
    return Math.max(1, Math.floor((playerCount - 1) / 2));
  }

  function updateImpostorOptions(room) {
    const select = $('cfg-impostors');
    if (!select) return;
    const playerCount = room?.players?.filter((p) => !p.isBot).length
      ?? room?.players?.length ?? 1;
    // Bots zählen als Spieler — sie nehmen am Spiel voll teil.
    const count = room?.players?.length ?? playerCount;
    const max = maxImpostorsForClient(count);
    const current = Number(select.value) || 1;
    if (select.options.length !== 3 || Number(select.options[2].value) !== max) {
      select.replaceChildren();
      for (let n = 1; n <= 3; n += 1) {
        const option = document.createElement('option');
        option.value = `${n}`;
        option.textContent = max >= n
          ? `${n}`
          : localText(`${n} — ab ${Math.min(2 * n + 1, 10)} Spielern`, `${n} — requires ${Math.min(2 * n + 1, 10)} players`);
        option.disabled = max < n;
        select.appendChild(option);
      }
    }
    if (current > max) {
      select.value = `${max}`;
      showToast(localText(`Bei ${count} Spielern sind maximal ${max} Impostoren möglich (mindestens die Hälfte muss Crew bleiben).`, `${count} players can have at most ${max} impostors.`));
    } else if (select.value !== `${current}` && !select.querySelector('option:checked')?.disabled) {
      select.value = `${current}`;
    }
  }

  // Antippen der ausgegrauten Option erklärt die Regel (statt Stummheit).
  $('cfg-impostors')?.addEventListener('click', (event) => {
    const option = event.target.closest('option');
    if (!option?.disabled) return;
    const count = state.room?.players?.length ?? 1;
    const max = maxImpostorsForClient(count);
    showToast(localText(`Bei ${count} Spielern sind höchstens ${max} Impostoren möglich.`,
      `With ${count} players, at most ${max} may be impostors.`));
    beep(300);
  });

  // ---------------------------------------------------------------- game //

  function showRoleOverlay(payload) {
    const overlay = $('role-overlay');
    const impostor = payload.role === 'IMPOSTOR';
    overlay.onclick = () => {
      overlay.onclick = null;
      overlay.classList.add('hidden');
      $('btn-settings').focus({ preventScroll: true });
      beep(impostor ? 180 : 560);
    };
    overlay.classList.remove('hidden');
    $('role-card').className = impostor ? 'role-card impostor' : 'role-card crew';
    $('role-card-title').textContent = impostor ? t('role.imp.title') : t('role.crew.title');
    const teammates = new Set((payload.teammates ?? []).map(({ id }) => id));
    const row = element('div', 'role-row');
    for (const player of state.room?.players ?? []) {
      if (impostor && player.id !== state.playerId && !teammates.has(player.id)) continue;
      const chip = element('span', teammates.has(player.id) ? 'role-chip mate' : 'role-chip');
      chip.append(avatar(player.colorId), element('span', 'player-name', player.name));
      row.append(chip);
    }
    const description = impostor ? t('role.imp.line1') : t('role.crew.line1') + ' ' + t('role.crew.and');
    $('role-card-detail').replaceChildren(element('p', 'pixel-sub', description), row);
    $('role-continue').textContent = t('btn.continue');
    $('role-continue').focus({ preventScroll: true });
    $('role-banner').classList.add('hidden');
    renderRole(payload);
  }

  function renderRole(payload) {
    const impostor = payload.role === 'IMPOSTOR';
    // Feldtest-Report (30.10): 'Cannot set properties of null' beim
    // Runden-Neustart — Elemente defensiv behandeln, UI friert nie ein.
    $('btn-kill')?.classList.toggle('hidden', !impostor);
    const teammates = $('teammates');
    if (teammates) {
      if (impostor && payload.teammates?.length) {
        teammates.textContent = `${t('meeting.impostorPartner')}: ${payload.teammates.map(({ name }) => name).join(', ')}`;
        teammates.classList.remove('hidden');
      } else {
        teammates.classList.add('hidden');
      }
    }

    // Build task list (crewmates), impostors can still get fake tasks.
    // Tap a task to open its minigame (gated by proximity in openTask).
    const list = $('task-list');
    list.replaceChildren();
    for (const task of payload.tasks ?? []) {
      const li = element('li', task.completed ? 'task-item done' : 'task-item');
      li.dataset.taskId = task.id;
      const button = element('button', 'task-item__button');
      button.disabled = Boolean(task.completed);
      const copy = element('span', 'task-item__copy', taskTitle(task));
      const location = taskLocationLabel(task);
      if (location) copy.append(element('small', '', location));
      button.append(icon(task.completed ? 'check' : 'task'), copy);
      button.addEventListener('click', () => openTask(task));
      li.append(button);
      list.append(li);
    }
    if (!payload.tasks?.length) list.append(element('li', '', localText('Keine Aufgaben', "No tasks")));
    state.tasks = payload.tasks ?? [];
    const countEl = $('task-count');
    if (countEl) countEl.textContent = `${payload.tasks?.length ?? 0}`;
    renderGameHud();
  }

  function taskLocationLabel(task) {
    const index = task.stageIndex ?? 0;
    const stage = task.stages?.length > 1
      ? taskStageLabel(task.stageLabels?.[index]) ?? `${t('tasks.stage')} ${index + 1}`
      : null;
    return [roomLabel(task.roomName), stage].filter(Boolean).join(' · ');
  }

  /** Team-Fortschritt im Live-Map-Header (aus room.taskProgress). */
  function renderTeamProgress(room) {
    const progress = room.taskProgress ?? { completed: 0, total: 0 };
    const total = progress.total || 0;
    const pct = total ? Math.round((progress.completed / total) * 100) : 0;
    const strip = document.getElementById('task-progress-strip');
    if (!strip) return;
    strip.classList.toggle('hidden', state.taskbarAlways === false);
    if (state.taskbarAlways === false) return;
    $('task-progress-fill').style.setProperty('--progress', pct / 100);
    strip.setAttribute('aria-valuenow', pct);
    $('task-label-count').textContent = pct + '%';
  }

  /** Report/Kill-Buttons je nach Nähe (Kill nur mit echten Zielen). */
  function renderGameHud() {
    const room = state.room;
    if (!room) return;
    // v19.15: Meeting-Await — Action-Knöpfe weg, stattdessen Meldung
    // "Begib dich zur Cafeteria" (nur Host sieht den Bestätigen-Button im
    // Meeting-Intro-Overlay, nicht im HUD).
    if (room.status === 'MEETING' && state.meetingAwaitActive) {
      $('btn-report')?.classList.add('hidden');
      $('btn-use')?.classList.add('hidden');
      $('btn-kill')?.classList.add('hidden');
      const msg = $('meeting-hud-msg');
      if (msg) {
        msg.classList.remove('hidden');
        msg.textContent = t('meeting.await.walk');
      }
      return;
    }
    const meetingMsg = $('meeting-hud-msg');
    if (meetingMsg) meetingMsg.classList.add('hidden');
    if (room.status !== 'IN_GAME') return;
    const imAlive = room.players.find((p) => p.id === state.playerId)?.isAlive;
    const taskbox = $('taskbox');
    taskbox.querySelector('summary').textContent =
      `${t('tasks.summary')} (${state.tasks?.filter((x) => !x.completed).length ?? 0})`;
    const bodies = state.nearbyBodies ?? [];
    const reportBtn = $('btn-report');
    reportBtn.classList.remove('hidden');
    reportBtn.disabled = !(bodies.length && imAlive !== false);
    reportBtn.classList.toggle('ready', bodies.length > 0 && imAlive !== false);
    const killBtn = $('btn-kill');
    if (!killBtn.classList.contains('hidden')) {
      // Divo (v19.13.7): als (toter) Geist gibt es keinen Kill mehr.
      if (imAlive === false) {
        killBtn.classList.add('hidden');
        killBtn.disabled = true;
      } else {
        const killLabel = killBtn.querySelector('.icon-label');
        const targets = state.killTargets ?? [];
        const cooldownLeft = Math.max(0, state.killReadyAt - Date.now());
        if (cooldownLeft > 0) {
          // Cooldown IMMER auf dem Knopf sichtbar (auch ohne Ziel in	range).
          killBtn.disabled = true;
          if (killLabel) killLabel.textContent = `${Math.ceil(cooldownLeft / 1000)}s`;
        } else {
          killBtn.disabled = !targets.length;
          if (killLabel) killLabel.textContent = t('btn.kill');
        }
        setActionCooldown(killBtn, cooldownLeft, room.config?.killCooldownMs ?? 20000);
        killBtn.classList.toggle('ready', targets.length > 0 && cooldownLeft <= 0);
      }
    }
    updateUseButton();
    updateEmergencyPanel();
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
      showToast(localText("Aufgaben sind während der Runde verfügbar.", "Tasks are available during a round."));
      return;
    }
    // Divo (v19.13.7): tote CREW darf als Geist weiter tasken (Among-Us-
    // Regel, Server-Gate erlaubt CREWMATE). Kein Client-Block mehr — der
    // Server sagt im Zweifel PLAYER_DEAD für tote Nebel-Tasks.
    if (task.completed) {
      showToast(localText("Diese Aufgabe ist bereits erledigt.", "You already completed this task."));
      return;
    }
    // Impostoren erledigen keine Tasks (nur anzeigen, nicht interaktiv).
    if (state.role?.role === 'IMPOSTOR') {
      showToast(localText('Impostoren können keine Aufgaben erledigen.', 'Impostors cannot complete tasks.'));
      beep(220);
      return;
    }
    if (!taskNear(task)) {
      showToast(task.roomName
        ? localText(`Zu weit weg \u2014 geh nach ${roomLabel(task.roomName)}.`, `Too far away. Go to ${roomLabel(task.roomName)}.`)
        : localText("Zu weit weg. Geh zum Aufgabenpunkt.", "Too far away. Go to the task marker."));
      beep(220);
      return;
    }
    if (!window.RlausTasks) {
      showToast(localText('Aufgaben konnten nicht geladen werden. Lade die App neu und tritt der Runde erneut bei.', "Tasks could not load. Reload the app and rejoin the round."));
      return;
    }
    const code = state.code;
    window.RlausTasks.launch(task, () => {
      if (state.room?.status !== 'IN_GAME' || state.code !== code) return;
      if (!state.socket?.connected) {
        showToast(localText('Keine Verbindung. Wiederhole die Aufgabe, sobald du wieder verbunden bist.', "No connection. Retry the task after reconnecting."));
        return;
      }
      state.socket.emit('task:complete', { code, taskId: task.id });
    });
    sfx('task_open');
  }

  function canReachSabotageSpot(spot) {
    const pos = state.selfPos;
    if (!pos || !(pos.confidence >= 0.4 && performance.now() - state.panelPositionAt <= 8000 &&
        Math.hypot(spot.x - pos.x, spot.y - pos.y) <= state.room.panelUseRadiusM)) return false;
    if (spot.roomType !== 'REACTOR') return pos.roomId === spot.roomId;
    const room = state.room.map?.rooms?.find(({ id }) => id === spot.roomId);
    return reactorContainsPosition(pos, room?.polygon ?? []);
  }

  /** Use-Knopf: nur erreichbare Ziele anbieten. */
  function useAction() {
    if (state.room?.status !== 'IN_GAME') return null;
    const sab = state.room?.sabotage;
    const alive = state.room.players.some(({ id, isAlive }) => id === state.playerId && isAlive);
    if (sab && alive) {
      if (sab.panelStatus && state.selfPos) {
        const spot = sab.fixSpots.find(canReachSabotageSpot);
        if (spot) return { label: t('panel.open'), kind: 'PANEL', panel: spot.id };
      }
      if (sab.type === 'LIGHTS' && roomIdContains('ELECTRICAL')) {
        return { label: localText("Licht reparieren", "Restore lights"), kind: 'FIX', panel: 'LIGHTS' };
      }
      if (sab.type === 'COMMS' && roomIdContains('COMMUNICATIONS')) {
        return { label: localText("Kommunikation", "Restore communications"), kind: 'FIX', panel: 'COMMS' };
      }
    }
    const task = nearestIncompleteTask();
    // Divo (4.11): Among-Us-Admin-Tisch — im ADMIN-Raum öffnet Use die
    // anonyme Raumbesetzung (graue Bohnen, keine Namen/Positionen).
    const admin = roomIdContains('ADMIN')
      ? { label: localText("Adminkarte", "Admin map"), kind: 'ADMIN_TABLE' } : null;
    // Divo (v19.12): in der Cafeteria öffnet Use IMMER den Meeting-Tisch —
    // der rote Knopf steckt im Feld, mit BLOCKIERT-Kappe wenn keine
    // Meetings mehr / kritische Sabotage.
    const emergency = alive && roomIdContains('CAFETERIA')
      ? { label: localText('Notfall', "Emergency"), kind: 'EMERGENCY' } : null;
    return chooseUseAction(state.role?.role, task ? { label: taskTitle(task), kind: 'TASK', task } : null,
      admin, emergency);
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
    // Feldtest 30.10 (Divo): Große Cafeteria, Task-Spot am Zentroid,
    // Use-Knopf fiel auf NOTFALL statt Task — Meeting statt Minigame.
    // Server-Gate (stageAt) akzeptiert GLEICHER RAUM als Nähe; der
    // Client folgt jetzt exakt: Radius-Sieger zuerst, sonst nächster
    // Task im selben Raum.
    let radiusBest = null;
    let radiusBestDist = Infinity;
    let roomBest = null;
    let roomBestDist = Infinity;
    for (const task of state.role?.tasks ?? []) {
      if (task.completed || task.x == null) continue;
      const d = Math.hypot((self.x ?? Infinity) - task.x, (self.y ?? Infinity) - task.y);
      const active = stagesOf(task);
      const spotRoomId = active?.roomId ?? task.roomId;
      if (d <= radius && d < radiusBestDist) {
        radiusBestDist = d;
        radiusBest = task;
      }
      if (spotRoomId && spotRoomId === self.roomId && d < roomBestDist) {
        roomBestDist = d;
        roomBest = task;
      }
    }
    return radiusBest ?? roomBest ?? null;
  }

  /** Aktiver 2-Stufen-Spot des Tasks (Stufe X hat eigene Koordinaten). */
  function stagesOf(task) {
    const stages = task?.stages ?? [];
    if (!stages.length) return null;
    return stages[task.stageIndex ?? 0] ?? null;
  }

  function emergencyLeft() {
    // Config erlaubt 0..3 pro Runde (Divo-Wahl in der Lobby); lokal
    // zaehlen wir unsere eigenen Drücke, der Server ist Torhüter.
    const perRound = state.room?.config?.emergencyMeetingsPerPlayer ?? 1;
    return Math.max(0, perRound - (state._emergencyUsedThisRound ?? 0));
  }

  /**
   * Divo-Design (v19.12): Meeting-Tisch-Bottom-Sheet. Kein Knopf im Hud —
   * das symbol lebt auf dem Tisch (Map-Canvas); Use am Tisch slidet das
   * Feld von unten rein (wo die Map ist). Kappe zu = blockiert.
   */
  function emergencyBlockedReason() {
    const room = state.room;
    const inGame = room?.status === 'IN_GAME'
      && room.players?.find((p) => p.id === state.playerId)?.isAlive !== false;
    if (!inGame) return 'game';
    if (room?.sabotage) return 'sabotage';
    if (emergencyLeft() <= 0) return 'exhausted';
    return null;
  }

  function showEmergencyPanel() {
    $('emergency-panel')?.classList.remove('hidden');
    updateEmergencyPanel();
  }

  function hideEmergencyPanel() {
    $('emergency-panel')?.classList.add('hidden');
    const dome = $('btn-emergency');
    dome?.classList.remove('pressed');
    if (dome) dome.disabled = false;
  }

  function updateEmergencyPanel() {
    const panel = $('emergency-panel');
    if (!panel) return;
    const visible = !panel.classList.contains('hidden');
    // Statuswechsel (Meeting/GameOver/Tot) schließt das Sheet sofort.
    if (state.room?.status !== 'IN_GAME') {
      if (visible) hideEmergencyPanel();
      return;
    }
    if (!visible) return;
    const reason = emergencyBlockedReason();
    // Tot: Topples sehen keinen Tisch-Dialog mehr (Among-Us-Regel).
    if (reason === 'game') {
      hideEmergencyPanel();
      return;
    }
    const dome = $('btn-emergency');
    const blocked = !!reason;
    if (dome) {
      dome.classList.toggle('blocked', blocked);
      dome.classList.toggle('open', !blocked);
      dome.disabled = blocked || dome.classList.contains('pressed');
    }
    const status = $('emergency-status');
    if (status) {
      const me = state.room?.players?.find((p) => p.id === state.playerId);
      const who = me?.name ?? me?.id ?? '???';
      const left = Math.max(0, emergencyLeft());
      status.textContent = reason === 'sabotage'
        ? localText('Notfallmeeting gesperrt. Sabotage läuft.', 'Emergency meeting unavailable. Sabotage is active.')
        : localText(`${who}: Notfallmeetings übrig: ${left}.`, `${who}: emergency meetings left: ${left}.`);
    }
  }

  $('btn-emergency')?.addEventListener('click', () => {
    const btn = $('btn-emergency');
    if (btn.disabled) {
      sfx('ui_select', 0.4);
      showToast(localText('Knopf geht nicht \u2014 Sabotage l\u00e4uft oder keine Meetings mehr.', "You cannot call a meeting while sabotage is active or after using all your meetings."));
      return;
    }
    if (!roomIdContains('CAFETERIA') || emergencyBlockedReason() || !state.socket?.connected) return;
    sfx('ui_select', 0.8);
    vibrate([60, 40, 60]);
    // Kappe-fallende Zeremonie (~1s), DANN startet das Meeting.
    btn.classList.add('pressed');
    btn.disabled = true;
    const code = state.code;
    setTimeout(() => {
      if (!btn.classList.contains('pressed')) return;
      hideEmergencyPanel();
      if (state.code !== code || emergencyBlockedReason() || !roomIdContains('CAFETERIA') || !state.socket?.connected) return;
      state._emergencyUsedThisRound = (state._emergencyUsedThisRound ?? 0) + 1;
      state.socket.emit('game:emergency', { code });
    }, 900);
  });

  $('btn-emergency-close')?.addEventListener('click', () => {
    sfx('panel_close', 0.5);
    hideEmergencyPanel();
  });

  function updateUseButton() {
    const useBtn = $('btn-use');
    const useLabel = useBtn.querySelector('.icon-label');
    const action = useAction();
    if (useLabel) useLabel.textContent = action ? action.label : t('btn.use');
    const inMeeting = state.room?.status !== 'IN_GAME';
    // Divo (v19.13.7): Tote Crew behält den Use-Button — Geister können
    // ihre Tasks weiter vollenden (Among-Us-Regel, Server erlaubt das).
    useBtn.classList.toggle('hidden', !state.room || inMeeting);
    useBtn.disabled = !action || inMeeting;
    useBtn.classList.toggle('ready', !!action && !inMeeting);
    useBtn.dataset.kind = action?.kind ?? '';
  }

  function setActionCooldown(button, remaining, duration) {
    button.classList.toggle('on-cooldown', remaining > 0);
    const progress = Math.max(0, Math.min(1, 1 - remaining / Math.max(1, duration)));
    button.style.setProperty('--cooldown', progress + 'turn');
  }

  function updateSabotageButton() {
    const sabBtn = $('btn-sabotage');
    if (!sabBtn) return;
    const impostor = state.role?.role === 'IMPOSTOR';
    // Divo (v19.13.7): tote Impostoren sabotieren WEITER (Among Us) —
    // nur der Kill-Button verschwindet mit dem Tod.
    sabBtn.classList.toggle('hidden', !impostor || state.room?.status !== 'IN_GAME');
    if (!impostor) return;
    const sab = state.room?.sabotage;
    const sabLabel = sabBtn.querySelector('.icon-label');
    const setSabLabel = (text) => {
      if (sabLabel) sabLabel.textContent = text;
    };
    if (sab) {
      setActionCooldown(sabBtn, 0, 1);
      if (sab.deadline) {
        const left = Math.max(0, Math.ceil((Date.parse(sab.deadline) - Date.now()) / 1000));
        setSabLabel(`${left} s`);
      } else {
        setSabLabel(localText('L\u00e4uft', "Active"));
      }
      sabBtn.disabled = false;
      sabBtn.classList.remove('ready');
      sabBtn.classList.add('sabotage-active');
      sabBtn.setAttribute('aria-label', t('sab.active'));
      return;
    }
    // Cooldown bis zur naechsten Sabotage als Countdown auf dem Knopf.
    sabBtn.classList.remove('sabotage-active');
    sabBtn.setAttribute('aria-label', t('btn.sabotage'));
    const cd = state.room?.sabotageCooldownUntil ?? 0;
    const remaining = Math.max(0, cd - Date.now());
    setActionCooldown(sabBtn, remaining, Math.max(remaining, 30000));
    const left = Math.ceil(remaining / 1000);
    sabBtn.classList.toggle('ready', left === 0);
    if (left > 0) {
      setSabLabel(`${left}s`);
      sabBtn.disabled = true;
      return;
    }
    setSabLabel(t('btn.sabotage'));
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
      showToast(localText('Keine Sabotage f\u00fcr diese Karte verf\u00fcgbar.', "No sabotage is available on this map."));
      return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'sabotage-picker';
    overlay.className = 'task-overlay';
    const card = document.createElement('div');
    card.className = 'task-card sabotage-select';
    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = localText('Sabotage w\u00e4hlen', "Choose sabotage");
    card.appendChild(title);
    const meta = {
      REACTOR: { label: t('sab.reactor'), hint: t('sab.reactorHelp') },
      O2: { label: localText('Sauerstoffausfall', 'Oxygen failure'), hint: localText('Reparatur in O₂ und Admin.', 'Repair in O₂ and Admin.') },
      LIGHTS: { label: localText('Lichtausfall', 'Lights out'), hint: t('sab.lights') },
      COMMS: { label: localText('Kommunikationsausfall', 'Communications down'), hint: t('sab.comms') },
    };
    for (const type of types) {
      const btn = document.createElement('button');
      btn.className = 'task-tap-btn sabotage-choice';
      btn.append(
        buttonArt('sabotage-' + type.toLowerCase()),
        element('strong', '', meta[type]?.label ?? type),
        element('small', '', meta[type]?.hint ?? ''),
      );
      btn.addEventListener('click', () => {
        overlay.remove();
        ensureSocket().emit('game:sabotage', { code: state.code, type });
        vibrate(60);
      });
      card.appendChild(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    cancel.textContent = localText('Abbrechen', "Cancel");
    cancel.addEventListener('click', () => overlay.remove());
    card.appendChild(cancel);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  /** Sabotage-Typen, die die aktuelle Karte hergibt (React/O2/EC/COMMS). */
  function sabotageTypesAvailable() {
    return state.room?.sabotageTypes ?? [];
  }

  function renderPanelMapWarning() {
    const warning = $('map-panel-warning');
    const roomTypes = state.room?.map?.rooms?.map(({ type }) => type) ?? [];
    const errors = [];
    if (roomTypes.includes('REACTOR') && !sabotageTypesAvailable().includes('REACTOR')) errors.push(t('panel.reactorSmall'));
    if (roomTypes.includes('O2') && roomTypes.includes('ADMIN') && !sabotageTypesAvailable().includes('O2')) errors.push(t('panel.oxygenSmall'));
    warning.textContent = errors.join(' · ');
    warning.hidden = errors.length === 0;
  }
  setInterval(() => {
    renderGameHud();
    renderSabotage();
  }, 500);
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
    const active = Boolean(sab && state.room?.status === 'IN_GAME');
    const critical = active && sab.deadline != null;
    $('screen-game').classList.toggle('alarm-frame', critical);
    banner.classList.toggle('hidden', !active);
    if (!active) return;
    const remaining = critical ? Math.max(0, Math.ceil((Date.parse(sab.deadline) - Date.now()) / 1000)) : 0;
    const details = {
      REACTOR: t('sab.reactorCountdown'),
      O2: t('sab.o2Countdown'),
      LIGHTS: t('sab.lights'),
      COMMS: t('sab.comms'),
    };
    const guidance = details[sab.type] ?? 'Sabotage';
    const chips = sab.panelStatus?.panels.map(({ state: panelState }, index) => {
      const label = sab.type === 'REACTOR' && panelState === 'OPEN' ? 'FREE' : panelState;
      return `${t('panel.number')} ${index + 1}: ${t(`panel.state.${label}`)}`;
    }) ?? [];
    const labels = (sab.fixSpots ?? []).map(({ roomType }) => roomLabel(roomType));
    const destination = [...new Set(labels)].join(' / ');
    const signature = [guidance, destination, ...chips].join('|');
    if (banner.dataset.guidance !== signature) {
      banner.dataset.guidance = signature;
      const status = element('span', 'sab-status-chips');
      for (const chip of chips) status.append(element('span', 'sab-status-chip', chip));
      banner.replaceChildren(icon('sabotage'), element('span', '', destination ? `${guidance} → ${destination}` : guidance),
        element('strong', 'sabotage-banner__timer'), status);
    }
    const timer = banner.querySelector('strong');
    timer.textContent = critical ? remaining + ' s' : '';
    timer.classList.toggle('hidden', !critical);
    timer.classList.toggle('urgent', critical && remaining < 10);
  }
  function projectorFor(key = null) {
    if (key) return key === state.projKey ? state.proj : null;
    const code = state.code;
    // Bevorzugt: 2-Punkt-Kalibrierung (permanent, gedreht + skaliert).
    const mapData = state.room?.map;
    const cal = mapData?.cal;
    if (cal?.p1 && cal?.p2 && Number.isFinite(cal.p1.lat)) {
      const calKey = `cal:${mapData.version ?? 0}:${Math.round(cal.p1.x)}:${Math.round(cal.p1.y)}`;
      if (state.projKey !== calKey) {
        state.proj = twoPointProjector(cal);
        state.projKey = state.proj ? calKey : null;
        // Merken: der SERVER hat die Kalibrierung einmal sauber geliefert.
        if (state.proj) state._lastGoodCal = { code, cal: JSON.parse(JSON.stringify(cal)) };
      }
      return state.proj;
    }
    // Feldlog 1.11 (Divo): nach Settings-Änderung meldete die App
    // fälschlich "nicht kalibriert". Der Server behält cal niemals weg
    // (getestet) — falls hier trotzdem ein Snapshot ohne cal kommt,
    // greift die letzte GUTE Kalibrierung desselben Raums.
    const last = state._lastGoodCal;
    if (last?.code === code) {
      state.proj = twoPointProjector(last.cal);
      state.projKey = state.proj ? `cal:cached` : null;
      if (state.proj) {
        return state.proj;
      }
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

  const GPS_FIX_MAX_AGE_MS = 10000;

  function isFreshGpsFix(timestamp, now = Date.now()) {
    return timestamp > 0 && now - timestamp <= GPS_FIX_MAX_AGE_MS;
  }

  function acceptGpsFix(pos) {
    state.gpsFix = pos.coords;
    state.gpsFixAt = pos.timestamp;
    state.gpsError = null;
    state.gpsAccM = pos.coords.accuracy ?? null;
    state.gpsHeading = (pos.coords.speed ?? 0) > 0.5 && Number.isFinite(pos.coords.heading)
      ? pos.coords.heading : null;
  }

  function useGpsFallback(now = Date.now()) {
    const fix = state.gpsFallbackFix;
    if (state.gpsError === 'denied' || isFreshGpsFix(state.gpsPreciseFixAt, now)) return;
    if (fix && fix.timestamp > (state.gpsFixAt ?? 0) && isFreshGpsFix(fix.timestamp, now)) {
      acceptGpsFix(fix);
    }
  }

  let gpsWatchIds = [];
  function ensureGpsLoop() {
    if (!navigator.geolocation || gpsWatchIds.length) return;
    attachMotionSensors();
    const preciseWatch = navigator.geolocation.watchPosition((pos) => {
      if (!isFreshGpsFix(pos.timestamp) || pos.timestamp < (state.gpsFixAt ?? 0)) return;
      state.gpsPreciseFixAt = pos.timestamp;
      acceptGpsFix(pos);
    }, (err) => {
      // Kein stillschweigendes Schlucken mehr: der Spieler sieht WARUM
      // sein Marker fehlt (Berechtigung verweigert / kein Fix / Timeout).
      state.gpsError = err?.code === 1 ? 'denied'
        : err?.code === 2 ? 'unavailable' : 'waiting';
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 });
    // Den letzten groben Fix für den Wechsel bereithalten.
    const fallbackWatch = navigator.geolocation.watchPosition((pos) => {
      if (pos.timestamp <= (state.gpsFallbackFix?.timestamp ?? 0) || !isFreshGpsFix(pos.timestamp)) return;
      state.gpsFallbackFix = pos;
      useGpsFallback();
    }, () => {}, { enableHighAccuracy: false, maximumAge: GPS_FIX_MAX_AGE_MS, timeout: 30000 });
    gpsWatchIds = [preciseWatch, fallbackWatch];
  }

  function stopGpsWatchers() {
    for (const id of gpsWatchIds) navigator.geolocation.clearWatch(id);
    gpsWatchIds = [];
    Object.assign(state, {
      gpsFix: null,
      gpsFixAt: 0,
      gpsPreciseFixAt: 0,
      gpsFallbackFix: null,
      gpsError: null,
      gpsAccM: null,
      gpsHeading: null,
    });
    stopGpsLoop();
  }

  /** GPS-Hinweiszeile im Spiel: nur sichtbar, wenn etwas nicht stimmt. */
  function renderGpsStatus() {
    const el = document.getElementById('gps-status');
    if (!el) return;
    const inGame = state.room?.status === 'IN_GAME';
    if (!inGame) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const proj = projectorFor();
    let msg = null;
    if (!('geolocation' in navigator)) msg = t('gps.noapi');
    else if (state.gpsError === 'denied') msg = t('gps.denied');
    else if (state.gpsError === 'unavailable' && !isFreshGpsFix(state.gpsFixAt)) msg = t('gps.unavailable');
    else if (!state.gpsFixAt) msg = t('gps.waiting');
    else if (!proj) msg = t('gps.noanchor');
    else if (!isFreshGpsFix(state.gpsFixAt)) msg = t('gps.lost');
    else if (state.positionRetryAt > 0) msg = t('gps.recovering');
    if (msg) {
      if (el.dataset.message !== msg) {
        el.dataset.message = msg;
        el.replaceChildren(icon('pin'), ' ', msg);
      }
      el.classList.remove('gps-status--ok');
      if (renderGpsStatus.lastMsg !== msg && msg !== t('gps.waiting') && msg !== t('gps.recovering')) {
        // Diagnose für das RLAUS-Log: warum der Projektor fehlt.
        const diag = state.room?.map?.cal?.p1
          ? 'cal-present-proj-null'
          : state._lastGoodCal?.code === state.code ? 'cal-missing-cached-fallback-failed' : 'cal-missing-in-room';
        // Phase dranhängen: zeigt beim nächsten Log sofort, WANN es
        // (IN_GAME erwartbar; Lobby wäre es ein Bug).
        logAppError('gps', `${msg} [${diag} room=${state.room?.status ?? '?'} code=${state.code}]`);
        renderGpsStatus.lastMsg = msg;
      }
    } else {
      const accuracy = Math.round(state.gpsAccM ?? 0);
      const label = accuracy ? 'GPS ±' + accuracy + ' m' : localText('GPS bereit', "GPS ready");
      if (el.dataset.message !== label) {
        el.dataset.message = label;
        el.replaceChildren(icon('pin'), ' ', label);
      }
      el.classList.add('gps-status--ok');
      renderGpsStatus.lastMsg = null;
    }
  }

  function stopGpsLoop() {
    // Watcher bleibt billig aktiv; der Sendetakt prüft den Status selbst.
    state.nearbyBodies = [];
    state.positionRetryAt = 0;
  }

  function shouldSendPosition(room) {
    return room?.status === 'IN_GAME'
      || (room?.status === 'MEETING' && room.meetingPhase === 'DISCUSSION' && !room.meetingConfirmed);
  }

  setInterval(() => {
    const room = state.room;
    if (!shouldSendPosition(room)) return;
    if (room.status === 'MEETING' && meetingRevealStarted) return;
    const nowMs = Date.now();
    useGpsFallback(nowMs);
    if (!isFreshGpsFix(state.gpsFixAt, nowMs) || nowMs < (state.positionRetryAt ?? 0)) return;
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
    // Der Server ordnet den geglätteten Fix einem Raum oder Korridor zu.
    state.posSmooth = smooth;
    const confidence = Math.min(1, Math.max(0, (60 - accuracy) / 60));
    const moved = state.lastSentPos
      ? Math.hypot(smooth.x - state.lastSentPos.x, smooth.y - state.lastSentPos.y)
      : Infinity;
    const sinceSend = nowMs - (state.lastSent?.at ?? 0);
    // Bewegen sich wir >1,5m -> so schnell wie sinnvoll (>=600ms);
    // stehen wir -> nur alle 2s (Batterie + Serverlast).
    if (moved > 1.5 && sinceSend < 600) return;
    if (moved <= 1.5 && sinceSend < 2000) return;
    emitPosition({ x: smooth.x, y: smooth.y, confidence });
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


  // -------------------------------------------------------- live map draw //

  // Cafeteria-Tischkreis für die Kartenansicht, passend zur Server-Physik.
  const TABLE_RADIUS_MIN_M = 1.6;
  const TABLE_RADIUS_MAX_M = 3.2;
  const TABLE_RADIUS_ROOM_FRACTION = 0.24;

  function cafeteriaTableOf(map) {
    const cafe = (map?.rooms ?? []).find((room) => room.type === 'CAFETERIA');
    if (!cafe?.polygon?.length || cafe.polygon.length < 3) return null;
    if (cafe.polygon.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    const x = cafe.polygon.reduce((sum, p) => sum + p.x, 0) / cafe.polygon.length;
    const y = cafe.polygon.reduce((sum, p) => sum + p.y, 0) / cafe.polygon.length;
    const minX = Math.min(...cafe.polygon.map((p) => p.x));
    const maxX = Math.max(...cafe.polygon.map((p) => p.x));
    const minY = Math.min(...cafe.polygon.map((p) => p.y));
    const maxY = Math.max(...cafe.polygon.map((p) => p.y));
    const minSide = Math.min(maxX - minX, maxY - minY);
    return {
      x,
      y,
      r: Math.max(TABLE_RADIUS_MIN_M, Math.min(TABLE_RADIUS_MAX_M,
        minSide * TABLE_RADIUS_ROOM_FRACTION)),
    };
  }

  /** Zeichnet den Meeting-Tisch (nur bei rp > 2 aufgerufen). */
  function drawMeetingTable(ctx, cx, cy, rp) {
    const pressableAtTable = emergencyBlockedReason() === null;
    // Fuß: dunkler Tisch-Teller
    ctx.save();
    if (!pressableAtTable) ctx.globalAlpha = 0.55;
    if (pressableAtTable) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);
      ctx.shadowColor = `rgba(255, 60, 70, ${0.35 + 0.35 * pulse})`;
      ctx.shadowBlur = 22;
    }
    ctx.fillStyle = '#4a5f7a';
    ctx.beginPath();
    ctx.arc(cx, cy, rp, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#2b3a4a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, rp, 0, Math.PI * 2);
    ctx.stroke();
    // zweite Platte (kleiner): das typische Doppel-Tisch-Layout
    ctx.fillStyle = '#39506b';
    ctx.beginPath();
    ctx.arc(cx, cy, rp * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#243244';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Embleme: gelber Sicherheitsschild + roter Knopf
    const er = rp * 0.34;
    ctx.fillStyle = '#f5d020';
    ctx.beginPath();
    ctx.arc(cx, cy - rp * 0.35, er * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1c1c';
    ctx.font = `bold ${Math.max(9, rp * 0.42)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('\u26A0', cx, cy - rp * 0.35 + er * 0.22);
    // roter Knopf mit Glaskappe
    const bx = cx;
    const by = cy + rp * 0.38;
    ctx.fillStyle = '#a21212';
    ctx.beginPath();
    ctx.arc(bx, by, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5b0909';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(bx, by - er * 0.35, er * 0.55, er * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.fillStyle = pressableAtTable ? '#ffe9e9' : 'rgba(255,255,255,0.55)';
    ctx.font = '7px Nunito, sans-serif';
    ctx.fillText('EMERGENCY', cx, cy + 2);
    ctx.textAlign = 'left';
  }

  const mapSuit = new Path2D('M18 24C19 11 27 6 37 7C49 8 56 20 56 33L54 53 49 57 48 65 37 65 35 57 28 57 26 65 15 65 14 53 7 52 8 34 15 30Z');
  const mapVisor = new Path2D('M27 26C32 22 46 23 51 27L51 31C44 34 33 34 27 31Z');
  const mapGhost = new Path2D('M12 25Q5 26 6 37L9 49l8 2c0 5-1 9-4 13 8 3 12-8 18-2 4 4 9 7 15-2 8-7 10 5 19-1-4-10-2-17-2-26C63 16 55 7 40 7 27 7 19 13 17 24Z');

  function drawGameMap() {
    const canvas = $('game-map');
    const map = state.room?.map;
    if (!canvas || !map?.nodes?.length) return;
    const wrap = canvas.parentElement;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * pixelRatio);
    const pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext('2d');
    const ghostAccent = document.documentElement.dataset.role === 'ghost'
      ? getComputedStyle(document.documentElement).getPropertyValue('--ghost-accent').trim()
      : '';
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const nodes = Object.fromEntries(map.nodes.map((node) => [node.id, node]));
    const points = [...map.nodes, ...(map.rooms ?? []).flatMap((room) => room.polygon ?? [])];
    const minX = Math.min(...points.map(({ x }) => x));
    const maxX = Math.max(...points.map(({ x }) => x));
    const minY = Math.min(...points.map(({ y }) => y));
    const maxY = Math.max(...points.map(({ y }) => y));

    // Keep room labels and points of interest clear of the HUD and action dock.
    const landscape = width > height;
    const padding = width < 440 ? 38 : 56;
    const top = Math.round(height * (landscape ? .25 : .24));
    const bottom = Math.round(height * (landscape ? .80 : .79));
    const right = width - padding;
    const centerX = width / 2;
    const centerY = (top + bottom) / 2;
    const fitScale = Math.min((right - padding) / Math.max(24, maxX - minX),
      (bottom - top) / Math.max(24, maxY - minY));

    state.mapZoomIdx = Number(browserStorage.getItem('rlaus_mapZoom')) === 1 ? 1 : 0;
    const zoomed = state.mapZoomIdx === 1 && state.selfPos?.x != null;
    const scale = fitScale * (zoomed ? 2.4 : 1);
    const anchorX = zoomed ? state.selfPos.x : (minX + maxX) / 2;
    const anchorY = zoomed ? state.selfPos.y : (minY + maxY) / 2;
    const toPx = (x, y) => {
      const px = centerX + (x - anchorX) * scale;
      const py = centerY + (y - anchorY) * scale;
      return zoomed
        ? [Math.max(padding, Math.min(right, px)), Math.max(top, Math.min(bottom, py))]
        : [px, py];
    };

    // corridors: server format is { id, a, b } between two nodes
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#51638e';
    for (const c of map.corridors ?? []) {
      const from = nodes[c.a];
      const to = nodes[c.b];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(...toPx(from.x, from.y));
      ctx.lineTo(...toPx(to.x, to.y));
      ctx.stroke();
    }

    // Room labels share space with task markers, so keep their panels apart.
    const roomLabels = [];
    ctx.lineWidth = 2;
    for (const r of map.rooms ?? []) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      ctx.strokeStyle = r.type === 'MEETING' ? 'rgba(74,222,128,0.7)' : 'rgba(255,209,102,0.55)';
      ctx.fillStyle = 'rgba(201, 214, 238, 0.11)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      poly.forEach((pt, i) => {
        const [px, py] = toPx(pt.x, pt.y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fill();
      if (r.name && r.type !== 'CAFETERIA') {
        // Cafeteria hat schon das Tisch-Label, kein doppeltes Außen-Label.
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        const minX = Math.min(...poly.map((p) => p.x));
        const maxX = Math.max(...poly.map((p) => p.x));
        const minY = Math.min(...poly.map((p) => p.y));
        // Label außerhalb des Polygons mit Pfeil zum Raum (Name -> Raum).
        // Individuelle Offsets pro Raum für bessere Platzierung.
        let offsetX = 0;
        let offsetY = -5; // standard: 5m oberhalb
        const name = r.name.toLowerCase();
        if (name === 'admin') { offsetX = +8; offsetY = -2; }   // Admin etwas nach rechts
        if (name === 'medbay') { offsetX = 0; offsetY = +6; }   // Medbay nach unten
        if (name === 'electrical') { offsetX = -6; offsetY = -4; }
        if (name === 'weapons') { offsetX = -2; offsetY = -6; }
        if (name === 'security') { offsetX = -2; offsetY = -6; }
        if (name === 'o2') { offsetX = -6; offsetY = -6; }
        if (name === 'reactor') { offsetX = 0; offsetY = -6; }
        if (name === 'nav') { offsetX = -6; offsetY = -4; }
        if (name === 'shields') { offsetX = +6; offsetY = -4; }
        if (name === 'comms') { offsetX = +6; offsetY = -4; }
        if (name === 'storage') { offsetX = 0; offsetY = -6; }

        const lx = (minX + maxX) / 2 + offsetX;
        const ly = minY + offsetY;
        let [plx, ply] = toPx(lx, ly);
        ctx.font = '700 12px Nunito, sans-serif';
        const roomName = roomLabel(r.name);
        const labelWidth = Math.min(ctx.measureText(roomName).width + 14, 112);
        plx = Math.max(labelWidth / 2 + 8, Math.min(width - labelWidth / 2 - 8, plx));
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const overlaps = roomLabels.some((label) =>
            Math.abs(plx - label.x) < (labelWidth + label.width) / 2 + 4 && Math.abs(ply - label.y) < 24);
          if (!overlaps) break;
          ply -= 24;
        }
        roomLabels.push({ x: plx, y: ply, width: labelWidth });
        const [pcx, pcy] = toPx(cx, cy);
        // Pfeil vom Namen zum Raum (Pfeilspitze am Raum).
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(plx, ply);
        ctx.lineTo(pcx, pcy);
        ctx.stroke();
        // Pfeilspitze am Raumzentrum.
        const dx = pcx - plx;
        const dy = pcy - ply;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const headLen = 8;
        ctx.beginPath();
        ctx.moveTo(pcx, pcy);
        ctx.lineTo(pcx - ux * headLen + uy * 4, pcy - uy * headLen - ux * 4);
        ctx.lineTo(pcx - ux * headLen - uy * 4, pcy - uy * headLen + ux * 4);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
        ctx.fillStyle = '#0b1020';
        ctx.strokeStyle = '#51638e';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(plx - labelWidth / 2, ply - 10, labelWidth, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f2f6ff';
        ctx.textAlign = 'center';
        ctx.fillText(roomName, plx, ply + 4, labelWidth - 10);
        ctx.textAlign = 'left';
      }
    }

    // Meeting-Tisch (v19.12, Divo): in der Cafeteria steht das runde
    // Meetings-Tischzeug mit rotem Knopf-Symbol — physisch gesperrt
    // (Kollision via Server), Symbol pulsiert wenn ein Press möglich ist.
    const table = cafeteriaTableOf(map);
    if (table) {
      const [cx, cy] = toPx(table.x, table.y);
      const rp = table.r * scale; // Radius auf der Canvas in Pixel
      if (Number.isFinite(rp) && rp > 2) {
        drawMeetingTable(ctx, cx, cy, rp);
        // Cafeteria-Label direkt unter dem Tisch, immer sichtbar.
        const pressable = emergencyBlockedReason() === null;
        ctx.fillStyle = pressable ? '#ffe9e9' : 'rgba(255,255,255,0.8)';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('CAFETERIA', cx, cy + rp + 14);
        ctx.textAlign = 'left';
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
      ctx.fillText(spot.id ? String(fixSpots.indexOf(spot) + 1) : '!', fx, fy + 5);
      ctx.textAlign = 'left';
    }

    // v19.15: Cafeteria-Beacon waehrend Meeting-Await — roter, dauerhaft
    // aufblinkender Punkt am Meetings-Tisch, damit alle wissen wohin.
    if (state.meetingAwaitActive) {
      const table = cafeteriaTableOf(map);
      if (table) {
        const [bx, by] = toPx(table.x, table.y);
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 180));
        ctx.fillStyle = `rgba(239,68,68,${pulse})`;
        ctx.beginPath();
        ctx.arc(bx, by, table.r * scale * 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, table.r * scale * 0.9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(t('meeting.beacon'), bx, by + table.r * scale * 0.35);
        ctx.textAlign = 'left';
      }
    }

    // task markers: echte Server-Koordinaten (roomId/roomName/x/y);
    // \u00e4ltere Runden ohne Spots fallen auf Karten-Knoten zur\u00fcck.
    const eta = state.tasks ?? state.role?.tasks ?? [];
    const taskHits = [];
    // Mehrere Tasks im selben Raum: Marker leicht versetzt (kein Stack).
    const roomTaskSeen = {};
    let taskIdx = 0;
    for (const task of eta) {
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
      const near = taskNear(task);
      const radius = near ? 12 : 8;
      ctx.fillStyle = ghostAccent || '#f5d84a';
      ctx.strokeStyle = near ? '#f2f6ff' : '#111a30';
      ctx.lineWidth = near ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111a30';
      ctx.font = '800 13px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', tx, ty + 4);
      ctx.textAlign = 'left';
      taskHits.push({ x: tx, y: ty, task });
    }
    state._taskHits = taskHits;



    // Bots (nur virtuelle Bewohner): Crew hellblau, IMPOSTOR-BOTS ROT
    // (Divo v19.13.4: der Feind soll sichtbar sein, solange getestet wird).
    if (showBotsEnabled()) {
      const groups = [
        { list: state.botPositions?.crew, impostor: false },
        { list: state.botPositions?.impostor, impostor: true },
      ];
      for (const group of groups) {
        for (const bot of group.list ?? []) {
          if (bot.x == null) continue;
          const [bx, by] = toPx(bot.x, bot.y);
          ctx.fillStyle = group.impostor
            ? 'rgba(239, 68, 68, 0.95)'
            : 'rgba(147, 197, 253, 0.9)';
          ctx.beginPath();
          ctx.arc(bx, by, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = group.impostor ? '#fff' : 'rgba(255,255,255,0.85)';
          ctx.font = '600 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(group.impostor ? `\u2620 ${bot.name ?? 'Bot'}` : (bot.name ?? 'Bot'), bx, by - 12);
          ctx.textAlign = 'left';
        }
      }
    }

    // corpses the player has discovered
    const lightsOut = state.room?.sabotage?.type === 'LIGHTS' && state.role?.role !== 'IMPOSTOR';
    for (const body of lightsOut ? [] : state.nearbyBodies ?? []) {
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
      const self = state.room.players.find(({ id }) => id === state.playerId);
      const suitColor = colorChipHex(self?.colorId);
      const turn = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : (Date.now() % 1600) / 1600;
      ctx.strokeStyle = ghostAccent || suitColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = .65 - turn * .32;
      ctx.beginPath();
      ctx.arc(sx, sy, 16 + 6 * turn, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
      ctx.save();
      ctx.translate(sx - 12, sy - 13);
      ctx.scale(.38, .38);
      ctx.fillStyle = suitColor;
      ctx.strokeStyle = '#070a14';
      ctx.lineWidth = 4;
      if (ghostAccent) ctx.globalAlpha = .72;
      ctx.fill(ghostAccent ? mapGhost : mapSuit);
      ctx.stroke(ghostAccent ? mapGhost : mapSuit);
      ctx.fillStyle = ghostAccent || '#81e0f7';
      ctx.fill(mapVisor);
      ctx.restore();
      ctx.fillStyle = '#f2f6ff';
      ctx.font = '700 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(localText('DU', "YOU"), sx, sy - 16);
      ctx.textAlign = 'left';
    }

    // Lights-Sabotage: Crew sieht fast nichts (Sommerfolientausch ~0.72 Deckkraft).
    if (lightsOut) {
      ctx.fillStyle = 'rgba(2, 4, 10, 0.78)';
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.75)';
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(localText("Licht ausgefallen · Geh zur Stromversorgung", "Lights out · Go to Electrical"), w / 2, h / 2);
      ctx.textAlign = 'left';
    }
  }
  $('btn-map-zoom').addEventListener('click', () => {
    const next = (Number(browserStorage.getItem('rlaus_mapZoom')) === 1) ? 0 : 1;
    browserStorage.setItem('rlaus_mapZoom', String(next));
    beep(next ? 520 : 380);
    drawGameMap();
  });

  // Rundenabbruch (Host only, zweistufig bestätigt — kein Fehlklick).
  document.addEventListener('click', (event) => {
    const target = event.target.closest('#btn-abort');
    if (!target) return;
    if (state.abortArmed) {
      state.abortArmed = false;
      target.classList.remove('abort-armed');
      sfx('notification', 0.4);
      ensureSocket().emit('game:abort', { code: state.code });
    } else {
      state.abortArmed = true;
      target.classList.add('abort-armed');
      showToast(localText('Nochmal dr\u00fccken: Runde WIRKLICH abbrechen? Alle zur\u00fcck in die Lobby.', "Tap again to end the round and return everyone to the lobby."));
      setTimeout(() => {
        state.abortArmed = false;
        target.classList.remove('abort-armed');
      }, 4000);
    }
  });
  window.addEventListener('resize', () => drawGameMap());
  window.addEventListener('orientationchange', () => setTimeout(drawGameMap, 300));

  function renderPhaseHint(room) {
    if (!state.role) return;
    $('game-phase-hint').textContent = ''; // Lebenden-Count nur im Meeting
    // Divo (v19.13.7): kein Raumcode mehr im Spiel — der Code lebt nur in
    // der Lobby (Beitreten mitten im Spiel ist eh verboten).
    $('btn-abort')?.classList.toggle(
      'hidden',
      !(state.isHost && room?.status === 'IN_GAME'),
    );
    // Abort braucht Klick-Doppelbestätigung (armed-Flag, kein Fehlklick).
    state.abortArmed = false;
  }

  /**
   * Among-Us-Admin-Tisch (Divo 4.11): Overlay über der Spielkarte, zeichnet
   * alle Räume mit anonymen grauen Bohnen-Anzahl-Indikatoren. Pollt alle
   * 2s `game:admin_table` (Server-Gate: man muss IM Admin-Raum stehen).
   */
  function openAdminTable() {
    const overlay = $('admin-table');
    if (!overlay) return;
    state.adminTableLast = null;
    overlay.classList.remove('hidden');
    $('btn-admin-table-close').onclick = closeAdminTable;
    window.clearInterval(state.adminTableTimer);
    requestAdminTableState();
    state.adminTableTimer = window.setInterval(requestAdminTableState, 2000);
  }

  function closeAdminTable() {
    window.clearInterval(state.adminTableTimer);
    state.adminTableTimer = null;
    $('admin-table')?.classList.add('hidden');
  }

  function requestAdminTableState() {
    ensureSocket().emit('game:admin_table', { code: state.code });
  }

  function drawAdminTable() {
    const canvas = $('admin-table-canvas');
    const data = state.adminTableLast;
    if (!canvas || !data) return;
    const map = state.room?.map;
    if (!map?.nodes?.length) return;
    canvas.width = canvas.clientWidth * 2;
    canvas.height = canvas.clientHeight * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    const pad = 18;
    const nodes = map.nodes;
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxY = Math.max(...nodes.map((n) => n.y));
    const scale = Math.min(
      (canvas.width / 2 - pad * 2) / (maxX - minX || 50),
      (canvas.height / 2 - pad * 2) / (maxY - minY || 50),
    );
    const toPx = (x, y) => [pad + (x - minX) * scale, pad + (y - minY) * scale];

    const status = $('admin-table-status');
    if (data.blocked) {
      // Comms-Sabotage: grauer Plan, keine Spielerdaten (Among-Us-Regel).
      status.textContent = localText("KOMMUNIKATION GESTÖRT", "COMMUNICATIONS DOWN");
      status.style.color = '#9aa4b2';
    } else {
      const total = Object.values(data.counts).reduce((s, c) => s + c, 0);
      const alive = (state.room?.players ?? []).filter((p) => p.isAlive).length;
      status.textContent = total > 0
        ? localText(`Spieler in erfassten Räumen: ${total}/${alive}`, `Players in tracked rooms: ${total}/${alive}`)
        : localText('Keine Spieler in erfassten Räumen.', 'No players in tracked rooms.');
      status.style.color = '#dff7e6';
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.font = '600 11px system-ui';
    ctx.textAlign = 'center';
    for (const r of map.rooms ?? []) {
      const poly = r.polygon ?? [];
      if (poly.length < 3) continue;
      ctx.beginPath();
      poly.forEach((pt, idx) => {
        const [px, py] = toPx(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = r.type === 'ADMIN' && !data.blocked
        ? 'rgba(74, 222, 128, 0.22)'
        : 'rgba(74, 222, 128, 0.10)';
      ctx.strokeStyle = 'rgba(134, 239, 172, 0.85)';
      ctx.fill();
      ctx.stroke();
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      const [sx, sy] = toPx(cx, cy);
      ctx.fillStyle = 'rgba(220, 255, 230, 0.85)';
      ctx.fillText(roomLabel(r.name), sx, sy - 8);
      // Graue anonyme Bohnen (Among-Us-Tabellen-Optik): Anzahl als Punkte.
      const count = data.blocked ? 0 : (data.counts[r.id] ?? 0);
      const shown = Math.min(count, 6);
      for (let b = 0; b < shown; b += 1) {
        const beanX = sx - ((shown - 1) * 13) / 2 + b * 13;
        ctx.beginPath();
        ctx.arc(beanX, sy + 10, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#b6bec9';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.fill();
        ctx.stroke();
      }
      if (count > 6) {
        ctx.fillStyle = '#b6bec9';
        ctx.fillText(`+${count - 6}`, sx, sy + 28);
      }
    }
  }

  function showToast(message) {
    const toast = element('div', 'toast', message);
    $('toast-region').replaceChildren(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function connectionStatus(message = '') {
    const status = $('connection-status');
    status.textContent = message;
    status.classList.toggle('hidden', !message);
  }

  window.addEventListener('offline', () => connectionStatus(localText('Du bist offline. Prüfe deine Verbindung.', "You’re offline. Check your connection.")));
  window.addEventListener('online', () => connectionStatus(state.socket?.disconnected
    ? localText('Verbindung verloren. Wir verbinden dich neu.', "Connection lost. Reconnecting…") : ''));
  if (!navigator.onLine) connectionStatus(localText('Du bist offline. Prüfe deine Verbindung.', "You’re offline. Check your connection."));

  $('btn-report').addEventListener('click', () => {
    if (state.room?.status === 'MEETING') return;
    // Divo-Log 18: tote Spieler produzieren nur PLAYER_DEAD-Spam —
    // Ghosts melden nicht (Among Us), der Button ist eh disabled.
    const self = (state.room?.players ?? []).find((p) => p.id === state.playerId);
    if (self?.isAlive === false) {
      showToast(localText('Geister k\u00f6nnen nicht melden.', "Ghosts cannot report bodies."));
      return;
    }
    ensureSocket().emit('game:report', { code: state.code });
    vibrate([80]);
  });

  $('btn-kill').addEventListener('click', () => {
    const targets = (state.killTargets ?? []).filter(({ playerId }) => !isImpostorPartner(playerId));
    if (!targets.length) {
      showToast(localText("Kein Crewmitglied in Reichweite.", "No crewmate in range. Move closer."));
      return;
    }
    if (Date.now() < state.killReadyAt) {
      showToast(localText(`Ausschalten in ${Math.ceil((state.killReadyAt - Date.now()) / 1000)} s bereit.`, `Elimination ready in ${Math.ceil((state.killReadyAt - Date.now()) / 1000)} s`));
      return;
    }
    // Nearest victim wins: no extra pick dialog needed.
    sfx('kill_knife');
    ensureSocket().emit('game:kill', { code: state.code, targetPlayerId: targets[0].playerId });
    $('btn-kill').disabled = true;
    const killLabel2 = $('btn-kill').querySelector('.icon-label');
    if (killLabel2) killLabel2.textContent = t('btn.kill');
  });

  $('btn-use').addEventListener('click', () => {
    const action = useAction();
    if (!action) return;
    const socket = ensureSocket();
    if (action.kind === 'PANEL') {
      sabotagePanel.open(socket, state.code, state.room.sabotage, action.panel);
    } else if (action.kind === 'FIX') {
      socket.emit('game:sabotage_fix', { code: state.code, panel: action.panel });
      vibrate(60);
    } else if (action.kind === 'TASK') {
      openTask(action.task);
    } else if (action.kind === 'EMERGENCY') {
      showEmergencyPanel();
      vibrate(60);
    } else if (action.kind === 'ADMIN_TABLE') {
      openAdminTable();
      vibrate(60);
    }
  });

  $('btn-sabotage').addEventListener('click', () => {
    if (state.room?.status !== 'IN_GAME' || state.role?.role !== 'IMPOSTOR') return;
    const sab = state.room.sabotage;
    if (sab?.deadline || Date.now() < (state.room.sabotageCooldownUntil ?? 0)) {
      const message = sab
        ? [...$('sabotage-banner').children].map((child) => child.textContent.trim()).filter(Boolean).join(' ')
        : t('sab.cooldown');
      showToast(message || t('sab.active'));
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
      showToast(localText('Zeichne erst etwas auf die Karte, dann kalibrieren.', "Draw the map before calibrating."));
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
      status.textContent = localText(`GPS wird gesampelt \u2026 ${Math.ceil(cal2.msLeft / 1000)}s \u2014 ruhig stehen!`, `Sampling GPS… ${Math.ceil(cal2.msLeft / 1000)} s. Stand still.`);
      btn.disabled = true;
      btn.textContent = localText("Wird erfasst …", "Sampling…");
      return;
    }
    if (!cal2.p1) {
      steps.textContent = localText('Punkt A: geh zur ersten Ecke (stra\u00dfenklare Position).', "Point A: Go to the first landmark.");
      status.textContent = gpsDa ? localText('GPS da \u2714 \u2014 dr\u00fccke "Punkt A".', "GPS ready ✔ — capture Point A.")
        : t('gps.waiting');
      btn.disabled = !gpsDa;
      btn.textContent = localText("Punkt A erfassen", "Capture Point A");
      return;
    }
    if (cal2.step === 'pick') {
      steps.textContent = localText('Punkt A steht \u2014 jetzt die zweite Ecke (weit weg!).', "Point A saved. Go to the second landmark.");
      status.textContent = localText('Tippe auf der Karte DORT hin, wo du gerade stehst.', "Tap your current location on the map.");
      btn.disabled = true;
      btn.textContent = localText("Auf die Karte tippen …", "Tap the map…");
      return;
    }
    if (cal2.step === 'p2pick') {
      steps.textContent = localText('Punkt B kommt: geh zur zweiten Ecke, dr\u00fccke den Knopf.', "Go to the second landmark and capture Point B.");
      status.textContent = gpsDa ? localText('GPS da \u2714 \u2014 dr\u00fccke "Punkt B".', "GPS ready ✔ — capture Point B.")
        : t('gps.waiting');
      btn.disabled = !gpsDa;
      btn.textContent = localText("Punkt B erfassen", "Capture Point B");
      return;
    }
    if (cal2.step === 'p2-map') {
      steps.textContent = localText('Punkt A \u2014 Punkt B: tippe auf der Karte, wo du stehst.', "Tap Point B on the map.");
      status.textContent = localText('Tippe auf die zweite Ecke.', "Tap the second landmark.");
      btn.disabled = true;
      btn.textContent = localText("Auf die Karte tippen …", "Tap the map…");
      return;
    }
    if (cal2.step === 'done') {
      steps.textContent = localText('Kalibriert \u2014 ab jetzt startet die Karte automatisch richtig.', "Calibrated. The map will use these points automatically.");
      status.textContent = localText('Speichern \u2026', "Saving…");
      btn.disabled = true;
      btn.textContent = localText(' Gespeichert ', " Saved ");
      return;
    }
    steps.textContent = localText('Neukalibrieren \u00fcberschreibt die gespeicherten Punkte.', "Recalibrating replaces the saved points.");
    status.textContent = gpsDa ? localText('GPS da \u2714 \u2014 dr\u00fccke "Punkt A".', "GPS ready ✔ — capture Point A.")
      : t('gps.waiting');
    btn.disabled = !gpsDa;
    btn.textContent = localText("Punkt A erfassen", "Capture Point A");
  }

  function cal2Sample() {
    const gps = currentGps();
    if (!gps) {
      cal2UpdateUi();
      showToast(localText('Kein GPS \u2014 raus ins Freie, dann wieder dr\u00fccken.', "No GPS signal. Go outside and try again."));
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
        showToast(localText('Punkte sind zu dicht beieinander \u2014 nimm zwei weit entfernte Ecken.', "The points are too close together. Choose two landmarks farther apart."));
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
      showToast(localText("Kalibrierung gespeichert.", "Calibration saved."));
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
    // Straßen (Korridore) + Räume + Raum-Labels zeichnen. Korridore sind
    // Kanten {a, b} mit NODE-IDs — Feldtest 30.10: der Wizard zeigte sie
    // nicht, weil er vergeblich poly.points suchte (weshalb Divo blind
    // kalibrieren musste).
    const nodesById = new Map((mapData.nodes ?? []).map((n) => [n.id, n]));
    ctx.strokeStyle = 'rgba(189, 207, 224, 0.5)';
    ctx.lineWidth = Math.max(2, 4 * scale);
    for (const corridor of mapData.corridors ?? []) {
      const a = nodesById.get(corridor.a);
      const b = nodesById.get(corridor.b);
      if (!a || !b) continue;
      ctx.beginPath();
      const [ax2, ay2] = toPx(a.x, a.y);
      const [bx2, by2] = toPx(b.x, b.y);
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(bx2, by2);
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
        ctx.fillText(roomLabel(r.name), cx2, cy2);
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
      ctx.fillText(localText('Jetzt aufs Feld tippen!', "Tap your location on the map."), info.clientWidth / 2, info.clientHeight - 6);
    }
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
        ctx.fillText(roomLabel(r.name), cx, cy);
      }
    }
    // Fingerprint: aktueller GPS-Puls zeigt, WO der Fix denkt, dass du bist.
    $('calib-status').textContent = currentGps()
      ? localText('GPS bereit. Tippe auf den Raum, in dem du stehst.', 'GPS ready. Tap the room you are in.')
      : t('gps.unavailable');
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
      showToast(localText('Kein GPS-Signal! Geh raus und warte, dann wieder dr\u00fccken.', "No GPS signal. Go outside, wait for a fix, then try again."));
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
    showToast(localText('Setz-Punkt gespeichert \u2014 dein Marker erscheint mit dem n\u00e4chsten GPS-Fix.', "Reference point saved. Your marker will appear with the next GPS fix."));
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
      $('btn-calib-here').textContent = localText(`Ich stehe hier: ${best.type}`, `I am here: ${best.type}`);
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
    if (state.anchorRestoreTried === room.code) return;
    if (!room?.map?.nodes?.length) return;
    const cached = readSavedLocalMap();
    if (!sameMapNodes(cached, room.map)) return;
    if (cached.cal?.p1 && cached.cal?.p2) {
      state.anchorRestoreTried = room.code;
      ensureSocket().emit('map:cal', { code: state.code, cal: cached.cal });
    } else if (!Number.isFinite(room.map.anchor?.lat) && Number.isFinite(cached.anchor?.lat)) {
      state.anchorRestoreTried = room.code;
      ensureSocket().emit('map:anchor', {
        code: state.code,
        anchor: cached.anchor,
      });
      showToast(localText('GPS-Ursprung aus deiner gespeicherten Karte wiederhergestellt.', "Restored the GPS reference point from your saved map."));
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
      ? localText('Die Karte ist kalibriert. Du kannst die Punkte bei Bedarf neu erfassen.',
        'The map is calibrated. You can recapture the points if needed.')
      : t('map.anchorHint');
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#btn-set-anchor')) return;
    openCal2();
  });

  function adminSabotageBlockReason(type) {
    if (!state.socket?.connected) return 'settings.adminDisconnected';
    if (state.room?.status !== 'IN_GAME') return 'settings.adminRound';
    if (state.room.sabotage) return 'settings.adminActive';
    if (state.room.sabotageTypes?.includes(type.toUpperCase())) return null;
    const roomTypes = state.room.map?.rooms?.map((room) => room.type) ?? [];
    if (type === 'reactor' && roomTypes.includes('REACTOR')) return 'panel.reactorSmall';
    if (type === 'o2' && roomTypes.includes('O2') && roomTypes.includes('ADMIN')) return 'panel.oxygenSmall';
    return 'settings.adminUnavailable';
  }

  function renderAdminSabotage() {
    const section = $('settings-admin');
    section.hidden = state.canTriggerSabotage !== true;
    if (section.hidden) return;
    for (const type of ['reactor', 'o2']) {
      const reason = adminSabotageBlockReason(type);
      $(`btn-admin-${type}`).disabled = reason !== null;
      const hint = $(`admin-${type}-reason`);
      hint.hidden = reason === null;
      hint.textContent = reason ? t(reason) : '';
    }
  }

  for (const type of ['reactor', 'o2']) {
    $(`btn-admin-${type}`).addEventListener('click', () => {
      if (!state.canTriggerSabotage || adminSabotageBlockReason(type)) return;
      const socket = state.socket;
      socket.timeout(2500).emit('admin:sabotage_trigger', { code: state.code, type }, (error, reply) => {
        if (state.socket !== socket || (!error && reply?.ok)) return;
        const reason = adminSabotageBlockReason(type);
        showToast(t(reason ?? 'settings.adminRejected'));
        renderAdminSabotage();
      });
    });
  }

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
      renderAdminSabotage();
      $('settings-menu').classList.remove('hidden');
    } else if (target.id === 'btn-settings-close') {
      $('settings-menu').classList.add('hidden');
    } else if (target.id === 'btn-leave-from-menu') {
      $('settings-menu').classList.add('hidden');
      state.role = null;
      state.socket?.disconnect();
      state.socket = null;
      state.room = null;
      state.selfPos = null;
      state.posSmooth = null;
      state.botPositions = null;
      browserStorage.removeItem('rlaus_session');
      show('home');
    }
  });
  document.addEventListener('change', (event) => {
    const id = event.target.id;
    if (id === 'opt-sound') {
      browserStorage.setItem('rlaus_sound', event.target.checked ? '1' : '0');
    } else if (id === 'opt-sfx-vol') {
      browserStorage.setItem('rlaus_sfx_vol', String(Number(event.target.value) / 100));
      // Losgelassen -> ein Preview-Beep, damit man die Lautstaerke hoert.
      sfx('task_done');
    } else if (id === 'opt-vibration') {
      browserStorage.setItem('rlaus_vibration', event.target.checked ? '1' : '0');
    } else if (id === 'opt-show-bots') {
      browserStorage.setItem('rlaus_showBots', event.target.checked ? '1' : '0');
      drawGameMap();
    } else if (id === 'opt-lang') {
      setLang(event.target.value);
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'opt-sfx-vol') {
      browserStorage.setItem('rlaus_sfx_vol', String(Number(event.target.value) / 100));
    }
  });

  $('btn-rematch').addEventListener('click', () => {
    ensureSocket().emit('game:reset', { code: state.code });
    hideOverlaysNot();
    show('lobby');
  });
  $('btn-gameover-lobby').addEventListener('click', () => {
    hideOverlaysNot();
    if (state.room) renderLobby(state.room);
    show('lobby');
  });

  // ------------------------------------------------------------- meeting //


  // ---------------------------------------------- Divo-Meeting-Upgrade //

  const MEETING_INTRO_TIMERS = [];
  let meetingIntroActive = false;
  let meetingRevealStarted = false;

  function clearMeetingIntroTimers() {
    while (MEETING_INTRO_TIMERS.length) {
      window.clearTimeout(MEETING_INTRO_TIMERS.pop());
    }
  }

  function endMeetingIntro() {
    if (!meetingIntroActive) return;
    meetingIntroActive = false;
    clearMeetingIntroTimers();
    $('meeting-intro').classList.add('hidden');
    // Map-Beacon ausmachen, HUD wieder freigeben.
    state.meetingAwaitActive = false;
    state.meetingIntroSynced = false; // v19.15.1: nächstes Meeting kann erneut syncen
    drawGameMap();
    renderGameHud();
  }

  function meetingIntroShow(condition) {
    meetingIntroActive = true;
    const intro = $('meeting-intro');
    intro.classList.toggle('meeting-intro--await', condition === 'AWAIT');
    intro.classList.remove('hidden');
    $('meeting-overlay').classList.add('hidden');
    $('meeting-intro-card').className = 'meeting-intro-card meeting-intro-' + condition.toLowerCase();
  }

  function startMeetingIntro(payload) {
    closeGameDialogs();
    clearMeetingIntroTimers();
    endMeetingIntro();
    meetingIntroActive = true;
    meetingRevealStarted = false;
    meetingAwaitKey = null;
    state.stashedMeeting = payload;
    state.meetingIntroDone = false;
    state.meetingAwaitActive = true; // Map-Beacon + HUD-Sperre aktiv
    state.meetingIntroSynced = true; // v19.15.1: Intro läuft, kein Reconnect-Sync nötig
    const kind = payload?.emergency === true ? 'EMERGENCY' : 'REPORT';
    const isReport = kind === 'REPORT';
    sfx(isReport ? 'report_body' : 'emergency_alarm');
    meetingIntroShow(kind);
    const reporterName = (payload?.players ?? state.room?.players ?? [])
      .find((p) => p.id === payload?.reporterId)?.name ?? '';
    const me = state.playerId === payload?.reporterId;
    const big = isReport
      ? (me ? t('meeting.flash.report_you') : t('meeting.flash.report'))
      : (me ? t('meeting.flash.reporter_you_emergency') : t('meeting.flash.emergency'));
    const sub = isReport
      ? t('meeting.flash.report_body')
      : t('meeting.flash.emergency_body');
    const action = t(isReport ? 'meeting.flash.report_action' : 'meeting.flash.emergency_action');
    const dots = element('div', 'intro-wait-dots');
    dots.append(element('span'), element('span'), element('span'));
    meetingIntroContent(
      icon(isReport ? 'flag' : 'report', 'icon intro-icon'),
      element('div', 'intro-big', big),
      element('div', 'intro-sub', sub),
      element('div', 'intro-sub intro-action', action),
      dots,
    );
    // HUD-Sperre sofort: Knöpfe weg, Meldung auf der Map.
    renderGameHud();
    drawGameMap();
    MEETING_INTRO_TIMERS.push(window.setTimeout(stepMeetingAwait, 1600));
  }

  /** v19.15.1: Spätes Joinen während des Meeting-Await (Reconnect/Reload).
   * Springt direkt zum Await-Schritt — der Flash ist bei spätestem Einstieg
   * ohnehin schon vorbei. Alle sehen denselben Zähler und denselben Screen. */
  function startMeetingIntroLate() {
    closeGameDialogs();
    clearMeetingIntroTimers();
    endMeetingIntro();
    meetingIntroActive = true;
    meetingRevealStarted = false;
    meetingAwaitKey = null;
    state.meetingIntroSynced = true;
    state.meetingAwaitActive = true;
    meetingIntroShow('AWAIT');
    renderMeetingAwaitContent(true);

    renderGameHud();
    drawGameMap();
  }

  function stepMeetingAwait() {
    if (!meetingIntroActive) return;
    meetingIntroShow('AWAIT');
    renderMeetingAwaitContent(true);
  }

  function meetingIntroContent(...content) {
    const card = element('div', 'intro-card-inner');
    card.append(...content);
    $('meeting-intro-content').replaceChildren(card);
  }

  function meetingAwaitActive() {
    return $('meeting-intro-card').classList.contains('meeting-intro-await');
  }

  let meetingAwaitKey = null;
  function renderMeetingAwaitContent(force = false) {
    if (!meetingIntroActive || meetingRevealStarted) return;
    const players = state.room?.players ?? [];
    const self = players.find((p) => p.id === state.playerId);
    const inCafe = roomIdContains('CAFETERIA');
    const isHost = state.isHost;
    const walking = !inCafe && self?.isAlive !== false;
    const count = state.room?.meetingLivingCount ?? state.room?.meetingAdminCount ?? 0;
    const totalAlive = players.filter((p) => p.isAlive !== false).length;
    const ghosts = players.length - totalAlive;
    const key = [langActive(), !isHost && walking, isHost].join(':');
    const summary = t('meeting.counts.living') + ': ' + count + '/' + totalAlive
      + ' · ' + t('meeting.counts.ghosts') + ': ' + ghosts;
    const currentSummary = $('meeting-arrival-summary');
    if (!force && key === meetingAwaitKey && currentSummary) {
      if (currentSummary.textContent !== summary) currentSummary.textContent = summary;
      return;
    }
    meetingAwaitKey = key;

    const title = t(isHost ? 'meeting.await.title' : 'meeting.beacon');
    const instruction = t(isHost ? 'meeting.await.host' : walking ? 'meeting.await.walk' : 'meeting.await.waiting');
    const content = [element('div', 'intro-kicker', title)];
    if (!isHost && walking) content.push(icon('pin', 'icon intro-icon'));
    const arrivalSummary = element('div', 'intro-sub', summary);
    arrivalSummary.id = 'meeting-arrival-summary';
    content.push(element('div', 'intro-big', instruction), arrivalSummary);
    if (isHost) {
      const button = element('button', 'intro-confirm-btn', t('meeting.await.confirm'));
      button.id = 'meeting-admin-confirm';
      content.push(button);
    }
    meetingIntroContent(...content);
    if (isHost) setupMeetingAdminConfirm();
  }

  function setupMeetingAdminConfirm() {
    const btn = document.getElementById('meeting-admin-confirm');
    if (!btn) return;
    let armed = false;
    let resetTimer;
    const reset = () => {
      armed = false;
      btn.classList.remove('abort-armed');
      btn.textContent = t('meeting.await.confirm');
    };
    btn.addEventListener('click', () => {
      if (!meetingIntroActive || meetingRevealStarted || !state.isHost) return;
      if (!state.socket?.connected) {
        showToast(t('meeting.await.offline'));
        return;
      }
      if (!armed) {
        armed = true;
        btn.classList.add('abort-armed');
        btn.textContent = t('meeting.await.confirm_armed');
        resetTimer = window.setTimeout(reset, 5000);
        return;
      }
      sfx('ui_select');
      window.clearTimeout(resetTimer);
      state.socket.emit('game:meeting_confirm', { code: state.code, meetingId: state.room?.meetingId });
      reset();
    });
  }

  function runMeetingReveal() {
    if (!meetingIntroActive || meetingRevealStarted || !state.room?.meetingConfirmed) return;
    meetingRevealStarted = true;
    clearMeetingIntroTimers();
    meetingIntroShow('REVEAL');
    const payload = state.stashedMeeting ?? {};
    const kind = payload.emergency === true ? 'EMERGENCY' : 'REPORT';
    const players = payload.players ?? state.room?.players ?? [];
    const reporterName = players.find((p) => p.id === payload.reporterId)?.name
      ?? t('meeting.reveal.someone');
    const me = state.playerId === payload.reporterId;
    sfx('ui_select');
    meetingIntroContent(
      element('div', 'intro-kicker', t('meeting.reveal.begin')),
      icon('report', 'icon intro-icon'),
      element('div', 'intro-big', me ? t('meeting.reveal.reporter_you') : reporterName),
      element('div', 'intro-sub', me
        ? t(kind === 'EMERGENCY' ? 'meeting.reveal.reporter_you_emergency' : 'meeting.reveal.reporter_you')
        : t(kind === 'EMERGENCY' ? 'meeting.reveal.reporter_emergency' : 'meeting.reveal.reporter')),
    );
    MEETING_INTRO_TIMERS.push(window.setTimeout(stepMeetingUnfound, 2000));
  }

  function stepMeetingUnfound() {
    if (!meetingIntroActive) return;
    const unfound = state.room?.unfoundDeaths ?? [];
    if (unfound.length) {
      const players = state.stashedMeeting?.players ?? state.room?.players ?? [];
      const names = unfound
        .map((death) => players.find((p) => p.id === death.id)?.name ?? death.name)
        .join(' · ');
      sfx('notification');
      meetingIntroContent(
        icon('flag', 'icon intro-icon'),
        element('div', 'intro-big', t('meeting.reveal.unfound')),
        element('div', 'intro-sub', names),
      );
      MEETING_INTRO_TIMERS.push(window.setTimeout(finishMeetingIntro, 2000));
    } else {
      finishMeetingIntro();
    }
  }

  function finishMeetingIntro() {
    if (!meetingIntroActive) return;
    endMeetingIntro();
    state.meetingIntroDone = true;
    renderMeeting({
      phase: state.room.meetingPhase,
      reporterId: state.room.reporterId,
      discussionDeadline: state.room.discussionDeadline,
    });
    state.stashedMeeting = null;
  }

  function finalizeMeetingForVoting() {
    endMeetingIntro();
    state.meetingIntroDone = true;
    renderMeeting({ phase: 'VOTING' });
    state.stashedMeeting = null;
  }

  // ------------------------------------------------------ meeting UI //

  function renderMeeting({ phase, discussionDeadline, votingDeadline }) {
    closeGameDialogs();
    // Sting/Notfall-Hupe spielt das Meeting-INTRO (startMeetingIntro);
    // dieser Screen baut nur die Konferenz-Tafel.
    $('gameover-overlay').classList.add('hidden');
    $('eject-overlay').classList.add('hidden');
    $('meeting-overlay').classList.remove('hidden');
    endMeetingIntro();
    state.voted = state.room?.votedIds?.includes(state.playerId) ?? false;
    state.myVoteTargetId = null;
    $('vote-reveal-bar').classList.add('hidden');
    $('meeting-title').textContent = phase === 'DISCUSSION' ? t('meeting.title') : t('meeting.voteTitle');
    // Divo-Log 18: KEINE absolute Uhrzeit mehr — der Tisch tickt sekundengenau.
    if (phase === 'DISCUSSION' && discussionDeadline) {
      startVoteCountdown(discussionDeadline, t('meeting.discussionEnds'));
    }
    if (phase === 'VOTING') {
      // Voting-Countdown für alle (auch späte Joiner, die game:voting_started
      // verpasst haben). startVoteCountdown cleart alte Timer selbst.
      const votingEndsAt = votingDeadline ?? state.room?.votingDeadline;
      if (votingEndsAt) startVoteCountdown(votingEndsAt, t('meeting.votingEnds'));
    }
    const players = state.room?.players ?? [];
    const selfNow = players.find((p) => p.id === state.playerId);
    const ghostWatches = selfNow?.isAlive === false;
    // Diskussion: Warten, NICHT voten (sonst VOTING_NOT_OPEN-Log-Flood).
    if (phase === 'DISCUSSION') {
      openVoteList(players, null, t('meeting.discussing'), true);
      return;
    }
    // Geister schauen zu (Among Us): kein Vote, kein Skip, kein Fehler-Spam.
    if (ghostWatches) {
      openVoteList(players, null, t('meeting.ghostsWatch'), true);
      return;
    }
    openVoteList(
      players,
      (targetId) => voteFor(targetId),
      t(state.voted ? 'meeting.voteSubmitted' : 'meeting.vote'),
    );
  }

  /** Vote schicken + sofort locken (Apart: zurueckziehen ist serverseitig
      verboten \u2014 ALREADY_VOTED) und die Tafel auf "abgegeben" schalten. */
  function voteFor(targetId) {
    ensureSocket().emit('game:vote_cast', { code: state.code, targetId });
    state.voted = true;
    state.myVoteTargetId = targetId;
    state.myVoteAt = Date.now();
    sfx('vote_locked');
    setVotedHint();
    $('btn-skipvote').classList.add('hidden');
    $('vote-list').querySelectorAll('.vote-card').forEach((card) => {
      card.classList.remove('pickable', 'selected');
      card.querySelector('.vote-card__pick').disabled = true;
      card.querySelector('.vote-confirm')?.remove();
    });
    markMyVoteChip();
  }

  function markMyVoteChip() {
    const row = [...$('vote-list').children].find((card) => card.dataset.playerId === state.playerId);
    if (row && !row.querySelector('.voted-chip')) {
      const chip = buttonArt('voted', t('meeting.votedBadge'));
      chip.classList.add('voted-chip');
      row.appendChild(chip);
    }
  }

  function setVotedHint() {
    $('meeting-hint').textContent = t('meeting.voteSubmitted');
  }

  let voteCountdownTimer = null;
  let voteResultsTimer = null;
  // Divo-Log 18: "es gibt keinen countdown sondern es wird nur angezeigt
  // bis welche minute und stunde" — Meetings ticken jetzt SEKUNDENGENAU.
  // Der Server schickt ISO-Strings; 'ISO' - Date.now() war NaN -> der
  // Countdown zeigte "NaNs" (deswegen sah Divo GAR KEINEN Countdown).
  function startVoteCountdown(deadline, label = 'Ends in') {
    window.clearInterval(voteCountdownTimer);
    const el = $('vote-countdown');
    const endsAt = typeof deadline === 'string'
      ? new Date(deadline).getTime()
      : deadline;
    if (!endsAt || Number.isNaN(endsAt)) { el.textContent = ''; return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      el.textContent = `${label}: ${left}s`;
      if (left <= 0) window.clearInterval(voteCountdownTimer);
    };
    tick();
    voteCountdownTimer = window.setInterval(tick, 500);
  }

  /** Tablet-Karten (Farbchips) + Among-Us-Flow: Karte waehlen -> gruen/rot
      bestaetigen -> Vote gelockt.Reporter kriegt das Megafon-Piktogramm.
      isDiscussion: Karte ausgegraut (kein Vote moeglich). */
  function openVoteList(candidates, onPick, title, isDiscussion = false) {
    const list = $('vote-list');
    list.replaceChildren();
    $('meeting-hint').textContent = title;
    $('btn-skipvote').classList.toggle('hidden', !onPick || state.voted);
    for (const player of candidates) {
      const dead = player.isAlive === false;
      const pickable = Boolean(onPick) && !dead && !state.voted;
      const row = element('li', 'vote-card');
      row.dataset.playerId = player.id;
      row.classList.toggle('dead', dead);
      row.classList.toggle('discussion', isDiscussion);
      row.classList.toggle('pickable', pickable);
      const pick = element('button', 'vote-card__pick');
      pick.disabled = !pickable;
      const name = player.name + (dead ? ` · ${t('meeting.eliminated')}` : player.id === state.playerId ? ` (${t('meeting.you')})` : '');
      pick.append(avatar(player.colorId, dead), voteName(player.id, name, 'vote-name'));
      if (player.id === state.room?.reporterId && !dead) pick.append(icon('report', 'icon vote-megaphone'));
      row.append(pick);
      refreshVoteAffiliation(row);
      if (state.room?.votedIds?.includes(player.id)) {
        const chip = buttonArt('voted', t('meeting.votedBadge'));
        chip.classList.add('voted-chip');
        row.append(chip);
      }
      list.append(row);
    }
  }

  function refreshVoteAffiliation(row) {
    const partner = isImpostorPartner(row.dataset.playerId);
    const name = row.querySelector('.vote-name');
    name.classList.toggle('vote-impostor-partner', partner);
    row.querySelector('.vote-card__pick').setAttribute('aria-label',
      partner ? `${name.textContent} · ${t('meeting.impostorPartner')}` : name.textContent);
  }

  function isImpostorPartner(playerId) {
    return state.role?.role === 'IMPOSTOR'
      && (state.role.teammates ?? []).some(({ id }) => id === playerId && id !== state.playerId);
  }

  function voteName(playerId, name, className) {
    const label = element('span', className, name);
    if (isImpostorPartner(playerId)) label.classList.add('vote-impostor-partner');
    return label;
  }

  $('vote-list').addEventListener('click', (event) => {
    const row = event.target.closest('.vote-card.pickable');
    if (!row || state.voted) return;
    if (event.target.closest('.yes')) {
      voteFor(row.dataset.playerId);
      row.classList.remove('selected');
      row.querySelector('.vote-confirm')?.remove();
      return;
    }
    if (event.target.closest('.no')) {
      row.classList.remove('selected');
      row.querySelector('.vote-confirm')?.remove();
      row.querySelector('.vote-card__pick').focus();
      return;
    }
    if (!event.target.closest('.vote-card__pick')) return;
    for (const selected of $('vote-list').querySelectorAll('.selected')) {
      selected.classList.remove('selected');
      selected.querySelector('.vote-confirm')?.remove();
    }
    const confirmation = element('div', 'vote-confirm');
    const yes = element('button', 'yes');
    const no = element('button', 'no');
    yes.setAttribute('aria-label', t('meeting.voteConfirm'));
    no.setAttribute('aria-label', t('meeting.voteCancel'));
    yes.append(icon('check'));
    no.append(icon('close'));
    confirmation.append(yes, no);
    row.append(confirmation);
    row.classList.add('selected');
    yes.focus({ preventScroll: true });
    sfx('ui_select');
  });

  $('btn-skipvote').addEventListener('click', () => {
    if (state.voted) return;
    ensureSocket().emit('game:vote_cast', { code: state.code, skip: true });
    state.voted = true;
    state.myVoteAt = Date.now();
    sfx('vote_locked');
    $('btn-skipvote').classList.add('hidden');
    setVotedHint();
    markMyVoteChip();
    $('vote-list').querySelectorAll('.vote-card__pick').forEach((button) => { button.disabled = true; });
  });
  const nameInput = $('player-name');
  const syncNameCount = () => { $('name-count').textContent = nameInput.value.length + ' / 20'; };
  nameInput.addEventListener('input', syncNameCount);
  syncNameCount();
  const codeInput = $('join-code');
  const codeTiles = [...document.querySelectorAll('.code-field__tiles span')];
  function syncCodeTiles() {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
    codeTiles.forEach((tile, index) => {
      tile.textContent = codeInput.value[index] ?? '–';
      tile.toggleAttribute('data-next', index === codeInput.value.length);
    });
  }
  codeInput.addEventListener('input', syncCodeTiles);
  syncCodeTiles();
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const dismiss = [
      ['settings-menu', 'btn-settings-close'], ['cal2-overlay', 'btn-cal2-close'],
      ['calib-overlay', 'btn-calib-close'], ['emergency-panel', 'btn-emergency-close'],
      ['admin-table', 'btn-admin-table-close'], ['rejoin-overlay', 'btn-rejoin-no'],
      ['role-overlay', 'role-continue'],
    ].find(([overlay]) => !$(overlay).classList.contains('hidden'));
    if (dismiss) $(dismiss[1]).click();
  });

  // ------------------------------------------------------------ bootstrap //

  void refreshHostAccess();
  window.addEventListener('online', refreshHostAccess);

  // Service-Worker for offline install (only on secure origins).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  function recordActiveSession() {
    if (state.sessionAttached && state.socket?.connected) rememberSession();
  }
  window.addEventListener('pagehide', recordActiveSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') recordActiveSession();
  });

  let offeredSession;
  async function offerRejoin() {
    const saved = recentSession();
    if (state.socket || !(await checkSavedSession(saved)) || state.socket) return;
    offeredSession = saved;
    $('rejoin-text').textContent = localText(`Du warst in der Runde ${saved.code}. Wieder beitreten?`, `You were in round ${saved.code}. Rejoin?`);
    $('rejoin-overlay').classList.remove('hidden');
  }
  void offerRejoin();
  window.addEventListener('online', offerRejoin);
  $('btn-rejoin-yes').addEventListener('click', async () => {
    const saved = offeredSession;
    offeredSession = null;
    $('rejoin-overlay').classList.add('hidden');
    if (!(await checkSavedSession(saved)) || state.socket) return;
    ensureSocket();
    tryRejoin(saved);
  });
  $('btn-rejoin-no').addEventListener('click', () => {
    $('rejoin-overlay').classList.add('hidden');
    if (offeredSession) forgetSession(offeredSession.raw);
    offeredSession = null;
    showToast(localText("Du kannst später mit dem Lobby-Code zurückkehren.", "You can rejoin later with the lobby code."));
  });

  return {
    screens,
    show,
    ensureSocket,
    getState: () => state,
  };
})();

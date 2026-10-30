const enumsSchema = require('../../../shared/models/enums.schema.json');
const { randomUUID, createHash } = require('node:crypto');
const { GameError } = require('../game/errors');
const {
  DEFAULT_GAME_CONFIG,
  maxImpostorsFor,
  sanitizeGameConfig,
} = require('../game/config');
const { createTasks, groupTasksByPlayer } = require('../game/taskCatalog');
const { evaluateVictory, evaluateVictoryDetailed } = require('../game/victory');
const { sanitizeGameMap, sanitizeCal, validateForSave } = require('../game/map');
const {
  sanitizePositionEstimate,
  resolveRoomMembership,
  isPositionPlausible,
  nearestCorridorDistanceM,
  snapToCorridor,
  pointInPolygon,
} = require('../game/positioning');
const { canKill } = require('../game/proximity');

const roomCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/** Server-side code issuance: same alphabet as the client display allows. */
function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
const { PlayerRole, RoomStatus } = enumsSchema.$defs;

/**
 * Among-Us-Spielerfarben (18er-Palette): jeder Spieler bekommt die
 * erste FREIE Farbe beim Join; Leave gibt sie wieder frei. Die Farbe
 * schmückt Vote-Karten, Reveal-Chips und die Eject-Animation.
 */
const PLAYER_COLORS = Object.freeze([
  { id: 'red', hex: '#C51111' },
  { id: 'blue', hex: '#132ED1' },
  { id: 'green', hex: '#117F2D' },
  { id: 'pink', hex: '#ED54BA' },
  { id: 'orange', hex: '#EF7D0D' },
  { id: 'yellow', hex: '#F5F557' },
  { id: 'black', hex: '#3F474E' },
  { id: 'white', hex: '#D6E0F0' },
  { id: 'purple', hex: '#6B2FBB' },
  { id: 'brown', hex: '#71491E' },
  { id: 'cyan', hex: '#38FEDC' },
  { id: 'lime', hex: '#50EF39' },
  { id: 'maroon', hex: '#6B2B3C' },
  { id: 'rose', hex: '#ECC0D3' },
  { id: 'banana', hex: '#F0F0A8' },
  { id: 'gray', hex: '#8397A7' },
  { id: 'tan', hex: '#91897F' },
  { id: 'coral', hex: '#EC7578' },
]);

function pickFreeColor(existingPlayers) {
  const taken = new Set(existingPlayers.map((p) => p.colorId));
  return PLAYER_COLORS.find((c) => !taken.has(c.id))?.id ?? null;
}

/** Hashes a PIN with SHA-256 for secure storage. */
function hashPin(pin) {
  return createHash('sha256').update(pin).digest('hex');
}

// Named status aliases (validated against the shared schema at load time).
const STATUS_LOBBY = 'LOBBY';
const STATUS_MAP_SETUP = 'MAP_SETUP';
const STATUS_MAP_READY = 'MAP_READY';
const STATUS_IN_GAME = 'IN_GAME';
const STATUS_MEETING = 'MEETING';
const STATUS_GAME_OVER = 'GAME_OVER';

for (const status of [
  STATUS_LOBBY,
  STATUS_MAP_SETUP,
  STATUS_MAP_READY,
  STATUS_IN_GAME,
  STATUS_MEETING,
  STATUS_GAME_OVER,
]) {
  if (!RoomStatus.enum.includes(status)) {
    throw new Error(`shared/enums.schema.json is missing status ${status}`);
  }
}

const ROLE_CREWMATE = PlayerRole.enum[0];
const ROLE_IMPOSTOR = PlayerRole.enum[1];

/** How close a player must stand to a task spot to complete it. */
const DEFAULT_TASK_RADIUS_M = 8;

const MAX_PLAYERS = 10;

/**
 * Central in-memory game state. This class is the single source of truth:
 * every mutation happens here and every value leaving this class must go
 * through toPublicRoom() so secret data (roles, individual votes, internal
 * timestamps) can never leak to clients.
 *
 * Pure game rules live in ../game/* (config, taskCatalog, victory).
 */
class RoomStore {
  #roomsByCode = new Map();

  /** Session tokens per room/player. Never included in any projection. */
  #authTokens = new Map();

  /** Per-room player positions: code -> Map<playerId, positionState>. */
  #positions = new Map();

  /** Boundary strike counters: `${code}|${playerId}` -> {strikes, alerted}. */
  #boundaryStrikes = new Map();

  /** Grenz-Eskalation: code|playerId -> {outSince, alarmed}. */
  #boundaryEscalation = new Map();

  /** GPS-Jitter-Sturm: code|playerId -> consecutive POSITION_* rejections. */
  #posRejects = new Map();

  #clearBoundaryStrikes(code) {
    for (const key of [...this.#boundaryStrikes.keys()]) {
      if (key.startsWith(`${code}|`)) this.#boundaryStrikes.delete(key);
    }
    for (const key of [...this.#boundaryEscalation.keys()]) {
      if (key.startsWith(`${code}|`)) this.#boundaryEscalation.delete(key);
    }
    for (const key of [...this.#posRejects.keys()]) {
      if (key.startsWith(`${code}|`)) this.#posRejects.delete(key);
    }
  }

  /** Admin tracking auth: code -> Map<playerId, bool> (authenticated). */
  #adminAuth = new Map();

  /** PIN-Brute-Force-Gate: code -> { hits: number[], lockedUntil: number }. */
  #adminAuthAttempts = new Map();

  /**
   * Base config applied to every newly created room. Rooms may override
   * values at runtime via updateConfig() (host only, lobby only).
   */
  #baseConfig;

  constructor({ config } = {}) {
    this.#baseConfig = sanitizeGameConfig(config ?? {});
  }

  createRoom({ code, hostId, hostName = 'Host', config } = {}) {
    // Room codes come from the SERVER when the client offers none: no
    // collision UX, and a spoofer cannot pick "his" future codes.
    let roomCode = code;
    if (roomCode === undefined || roomCode === null || roomCode === '') {
      this.#pruneStaleRooms();
      do {
        roomCode = generateRoomCode();
      } while (this.#roomsByCode.has(roomCode));
    }
    if (!roomCodePattern.test(roomCode) || !isNonEmptyString(hostId)) {
      throw new GameError('INVALID_ROOM', 'A valid room code and host ID are required.');
    }

    if (this.#roomsByCode.has(roomCode)) {
      throw new GameError('ROOM_EXISTS', 'A room with this code already exists.');
    }

    // A custom config on creation is validated against the starting player
    // count (the host alone cannot satisfy a large impostor count yet).
    const mergedConfig = sanitizeGameConfig({
      ...this.#baseConfig,
      ...(config ?? {}),
    });

    const timestamp = new Date().toISOString();
    const room = {
      code: roomCode,
      hostId,
      players: [
        {
          id: hostId,
          name: sanitizeDisplayName(hostName),
          role: ROLE_CREWMATE,
          isAlive: true,
          isHost: true,
          joinedAt: timestamp,
        },
      ],
      status: STATUS_LOBBY,
      config: mergedConfig,
      map: null,
      tasks: [],
      ejectedPlayerIds: [],
      lastKillAt: 0,
      adminPinHash: null, // Host sets a separate PIN for admin tracking
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#roomsByCode.set(roomCode, room);
    return room;
  }

  getRoom(code) {
    return this.#roomsByCode.get(code) ?? null;
  }

  /** All active codes (watchdogs/health checks iterate rooms safely). */
  listCodes() {
    return [...this.#roomsByCode.keys()];
  }

  /** Why would the game end right now? (UI explains crew win after kill) */
  getVictoryDetails(code) {
    const room = this.getRoom(code);
    if (!room) return null;
    return evaluateVictoryDetailed({ players: room.players, tasks: room.tasks ?? [] });
  }

  getRequiredRoom(code) {
    const room = this.getRoom(code);
    if (!room) {
      throw new GameError('ROOM_NOT_FOUND', 'Room not found.');
    }
    return room;
  }

  /**
   * Memory GC: rooms live until the service restarts. Called from
   * createRoom (cheap and frequent enough for a party service): any room
   * not touched for over 24h (lobby abandoned mid-edit) is dropped.
   */
  #pruneStaleRooms() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [code, room] of this.#roomsByCode) {
      if (Date.parse(room.updatedAt ?? room.createdAt ?? 0) < cutoff) {
        this.#roomsByCode.delete(code);
        this.#positions.delete(code);
        this.#boundaryStrikes.clear?.();
        this.#authTokens.delete(code);
        this.#adminAuth.delete(code);
        this.#adminAuthAttempts.delete(code);
        this.#posRejects.delete(code);
      }
    }
  }

  /**
   * PUBLIC projection of the room. Contains: identities, alive flags,
   * aggregate progress, config, meeting aggregates (phase/deadlines/vote
   * count) and killReadyAt. NEVER contains roles, votes or task details.
   */
  toPublicRoom(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map(({ id, name, isAlive, isHost, joinedAt, isBot, colorId }) => ({
        id,
        name,
        isAlive,
        isHost,
        joinedAt,
        isBot: !!isBot,
        colorId: colorId ?? 'gray',
      })),
      status: room.status,
      config: { ...room.config },
      ...(room.map
        ? { map: JSON.parse(JSON.stringify(room.map)) }
        : {}),
      ...(room.winner ? { winner: room.winner } : {}),
      ejectedPlayerIds: [...(room.ejectedPlayerIds ?? [])],
      adminPinSet: room.adminPinHash !== null,
      ...this.#publicMeetingInfo(room),
      ...this.#publicKillInfo(room),
      ...this.#publicSabotageInfo(room),
      ...(room.sabotageCooldownUntil
        ? { sabotageCooldownUntil: room.sabotageCooldownUntil }
        : {}),
      taskProgress: getTaskProgress(room),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  /** Live countdown payload for the client overlays. */
  #publicSabotageInfo(room) {
    if (!room.sabotage) return {};
    return {
      sabotage: {
        type: room.sabotage.type,
        deadline: room.sabotage.deadline,
        // Wo muss gefixt werden? Map-Marker fuer die Crew (rote Badges).
        fixSpots: this.#sabotageFixSpots(room, room.sabotage.type),
        ...(room.sabotage.panels ? { panels: { ...room.sabotage.panels } } : {}),
      },
    };
  }

  /** Centroid(s) of the room(s) hosting the sabotage fix panels. */
  #sabotageFixSpots(room, type) {
    const targetsByType = {
      REACTOR: ['REACTOR'],
      O2: ['O2', 'ADMIN'],
      LIGHTS: ['ELECTRICAL'],
      COMMS: ['COMMUNICATIONS'],
    };
    const targetTypes = targetsByType[type] ?? [];
    const spots = [];
    for (const candidate of room.map?.rooms ?? []) {
      if (!targetTypes.includes(candidate.type)) continue;
      const points = candidate.polygon ?? [];
      if (!points.length) continue;
      const sum = points.reduce((acc, point) => {
        acc.x += point.x; acc.y += point.y;
        return acc;
      }, { x: 0, y: 0 });
      spots.push({
        roomType: candidate.type,
        roomId: candidate.id,
        x: sum.x / points.length,
        y: sum.y / points.length,
      });
    }
    return spots;
  }

  #publicMeetingInfo(room) {
    if (room.status !== STATUS_MEETING || !room.meeting) {
      return {};
    }
    return {
      meetingPhase: room.meeting.phase,
      reporterId: room.meeting.reporterId,
      ...(room.meeting.discussionEndsAt
        ? { discussionDeadline: room.meeting.discussionEndsAt }
        : {}),
      ...(room.meeting.votingEndsAt ? { votingDeadline: room.meeting.votingEndsAt } : {}),
      votedCount: Object.keys(room.meeting.votes).length,
    };
  }

  #publicKillInfo(room) {
    if (room.status !== STATUS_IN_GAME) {
      return {};
    }
    const cooldownMs = room.config.killCooldownMs;
    // No kill yet -> the impostor starts ready.
    if (cooldownMs <= 0 || !room.lastKillAt) {
      return { killReadyAt: 0 };
    }
    return { killReadyAt: room.lastKillAt + cooldownMs };
  }

  addPlayerToRoom(code, player) {
    const room = this.getRequiredRoom(code);

    if (room.players.length >= MAX_PLAYERS) {
      throw new GameError(
        'ROOM_FULL',
        `A room can hold at most ${MAX_PLAYERS} players.`,
      );
    }

    const joinable =
      room.status === STATUS_LOBBY ||
      room.status === STATUS_MAP_SETUP ||
      room.status === STATUS_MAP_READY;
    if (!joinable) {
      throw new GameError(
        'ROOM_NOT_JOINABLE',
        'Dieses Spiel ist schon im Gange \u2014 beitreten geht nur vor dem Start.',
      );
    }

    const playerWithDefaults = {
      ...player,
      role: player?.role ?? ROLE_CREWMATE,
    };

    if (!isValidPlayer(playerWithDefaults)) {
      throw new GameError('INVALID_PLAYER', 'A valid player is required.');
    }

    if (room.players.some(({ id }) => id === playerWithDefaults.id)) {
      throw new GameError('PLAYER_EXISTS', 'A player with this ID has already joined.');
    }

    room.players.push({
      ...playerWithDefaults,
      name: sanitizeDisplayName(playerWithDefaults.name),
      isAlive: true,
      isHost: false,
      colorId: pickFreeColor(room.players) ?? 'gray',
      joinedAt: new Date().toISOString(),
    });
    room.updatedAt = new Date().toISOString();
    return room;
  }

  /**
   * Host-only config update (host check happens in the socket layer).
   * Only allowed in LOBBY; impostor count must fit the CURRENT player count.
   */
  updateConfig(code, patch) {
    const room = this.getRequiredRoom(code);

    const configEditable =
      room.status === STATUS_LOBBY || room.status === STATUS_MAP_READY;
    if (!configEditable) {
      throw new GameError(
        'CONFIG_LOCKED',
        'Settings can only be changed in the lobby or once the map is ready.',
      );
    }

    if (patch !== undefined && (typeof patch !== 'object' || patch === null || Array.isArray(patch))) {
      throw new GameError('CONFIG_INVALID', 'Config must be an object.', {
        field: 'config',
      });
    }

    const next = sanitizeGameConfig({ ...room.config, ...(patch ?? {}) });

    if (next.impostorCount > maxImpostorsFor(room.players.length)) {
      throw new GameError(
        'CONFIG_INVALID_IMPOSTORS',
        `With ${room.players.length} players at most ${maxImpostorsFor(
          room.players.length,
        )} impostors are allowed.`,
        { field: 'impostorCount', max: maxImpostorsFor(room.players.length) },
      );
    }

    room.config = next;
    room.updatedAt = new Date().toISOString();
    return room;
  }

  /**
   * Removes a player while the room is still in the lobby. If the host
   * leaves, the longest-standing remaining member becomes the host; when
   * the last player leaves, the room is deleted entirely. During an ongoing
   * game players always persist so that win conditions stay stable.
   */
  removePlayer(code, playerId) {
    const room = this.getRoom(code);

    if (!room) {
      return { removed: false, deleted: false, room: null };
    }

    if (room.status === STATUS_MEETING || room.status === STATUS_IN_GAME || room.status === STATUS_GAME_OVER) {
      return { removed: false, deleted: false, room: this.toPublicRoom(room) };
    }

    const index = room.players.findIndex(({ id }) => id === playerId);
    if (index === -1) {
      return { removed: false, deleted: false, room: this.toPublicRoom(room) };
    }

    const wasHost = room.players[index].isHost;
    room.players.splice(index, 1);
    this.#authTokens.get(code)?.delete(playerId);

    if (room.players.length === 0) {
      this.#roomsByCode.delete(code);
      this.#authTokens.delete(code);
      this.#positions.delete(code);
      this.#clearBoundaryStrikes(code);
      return { removed: true, deleted: true, room: null };
    }

    if (wasHost) {
      let oldest = room.players[0];
      for (const candidate of room.players) {
        if (candidate.joinedAt < oldest.joinedAt) {
          oldest = candidate;
        }
      }
      oldest.isHost = true;
      room.hostId = oldest.id;
    }

    room.updatedAt = new Date().toISOString();
    return { removed: true, deleted: false, room: this.toPublicRoom(room) };
  }

  /** Issues a fresh session token; delivered privately via session:created. */
  issueToken(code, playerId) {
    const room = this.getRequiredRoom(code);
    if (!room.players.some(({ id }) => id === playerId)) {
      throw new GameError('UNKNOWN_PLAYER', 'You are not part of this room.');
    }

    const token = randomUUID();
    const tokensForRoom = this.#authTokens.get(code) ?? new Map();
    tokensForRoom.set(playerId, token);
    this.#authTokens.set(code, tokensForRoom);
    return token;
  }

  verifyToken(code, playerId, token) {
    return (
      isNonEmptyString(token) &&
      this.#authTokens.get(code)?.get(playerId) === token
    );
  }

  /**
   * Starts the game using the room's config: distributes the configured
   * number of impostors randomly, generates crewmate tasks and switches the
   * room to IN_GAME. Callers distribute assignments/tasks/teammates per
   * socket privately and broadcast only the public room.
   */
  startGame(code) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MAP_READY) {
      throw new GameError(
        'MAP_REQUIRED',
        'Set up and save the map before starting the game.',
        { field: 'status', currentStatus: room.status },
      );
    }

    try {
      validateForSave(room.map);
    } catch (error) {
      // Defensive: a stored map should always be valid, but never allow a
      // corrupted state to start a game.
      throw new GameError(
        'MAP_REQUIRED',
        'The stored map is not valid enough to start the game.',
        { field: 'map' },
      );
    }

    const playerCount = room.players.length;
    if (playerCount < 2) {
      throw new GameError(
        'INSUFFICIENT_PLAYERS',
        'At least two players are required to start the game.',
      );
    }

    const { impostorCount } = room.config;
    if (impostorCount > maxImpostorsFor(playerCount)) {
      throw new GameError(
        'CONFIG_INVALID_IMPOSTORS',
        `With ${playerCount} players at most ${maxImpostorsFor(
          playerCount,
        )} impostors are allowed.`,
        { field: 'impostorCount', max: maxImpostorsFor(playerCount) },
      );
    }

    // Partial Fisher-Yates: pick N distinct random impostor seats.
    const indices = room.players.map((_, index) => index);
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const impostorSeats = new Set(indices.slice(0, impostorCount));

    const crewmateRole = ROLE_CREWMATE;
    const impostorRole = ROLE_IMPOSTOR;

    room.players = room.players.map((player, index) => ({
      ...player,
      role: impostorSeats.has(index) ? impostorRole : crewmateRole,
      isAlive: true,
    }));

    room.tasks = createTasks(room.players, room.config.tasksPerCrewmate, room.map);
    delete room.winner;
    room.ejectedPlayerIds = [];
    room.lastKillAt = 0;
    room.corpses = [];
    delete room.sabotage;
    room.sabotageCount = 0;
    delete room.sabotageCooldownUntil;
    room.emergencyUsed = {};
    room.status = getEnumValue(RoomStatus, 'IN_GAME');
    room.updatedAt = new Date().toISOString();

    const assignments = {};
    const teammatesByPlayer = {};
    for (const player of room.players) {
      assignments[player.id] = player.role;
      teammatesByPlayer[player.id] =
        player.role === impostorRole
          ? room.players
              .filter((other) => other.role === impostorRole && other.id !== player.id)
              .map(({ id, name }) => ({ id, name }))
          : [];
    }

    return {
      assignments,
      teammatesByPlayer,
      tasksByPlayer: groupTasksByPlayer(room.tasks),
      room: this.toPublicRoom(room),
    };
  }

  getTasksForPlayer(code, playerId) {
    const room = this.getRequiredRoom(code);
    assertKnownPlayer(room, playerId);
    return room.tasks.filter((task) => task.assignedTo === playerId);
  }

  completeTask(code, playerId, taskId, { skipProximity = false } = {}) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);
    assertKnownPlayer(room, playerId);

    if (!isNonEmptyString(taskId)) {
      throw new GameError('INVALID_TASK', 'A task ID is required.');
    }

    const task = room.tasks.find((entry) => entry.id === taskId);
    if (!task || task.assignedTo !== playerId) {
      throw new GameError('TASK_NOT_FOUND', 'Task not found for this player.');
    }

    if (!isPlayerAlive(room, playerId)) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot complete tasks.');
    }

    if (task.completed) {
      throw new GameError('TASK_ALREADY_COMPLETED', 'This task is already completed.');
    }

    // Two-stage progress: skipProximity completes ALL stages at once
    // (bot engine — its walking already models the effort), humans work
    // through stage by stage, each stage gated by proximity to its spot.
    const stages = task.stages?.length ? task.stages : null;
    if (!stages) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
      room.updatedAt = task.completedAt;
      return {
        room: this.toPublicRoom(room),
        progress: getTaskProgress(room),
        completedTaskId: task.id,
        winner: evaluateVictory(room),
      };
    }

    if (!skipProximity) {
      const stage = stages[task.stageIndex ?? 0];
      const stageAt = (spot) =>
        spot != null && (
          (spot.roomId != null && own?.roomId === spot.roomId) ||
          (spot.x != null && own != null &&
            Math.hypot(own.x - spot.x, own.y - spot.y) <= (room.config?.taskRadiusM ?? DEFAULT_TASK_RADIUS_M))
        );
      const own = this.getPlayerPosition(code, playerId);
      if (!stageAt(stage)) {
        throw new GameError(
          'TASK_TOO_FAR',
          stage?.roomName
            ? `Du musst daf\u00fcr nach ${stage.roomName} (Stufe ${task.stageIndex + 1}).`
            : 'Du musst an der Stelle des Tasks stehen.',
          { field: 'task.position' },
        );
      }
      if (task.stageIndex + 1 < stages.length) {
        // Stage done, next stage becomes the active spot.
        task.stageIndex += 1;
        const next = stages[task.stageIndex];
        task.roomId = next.roomId;
        task.roomName = next.roomName;
        task.roomType = next.roomType;
        task.x = next.x;
        task.y = next.y;
        room.updatedAt = new Date().toISOString();
        return {
          room: this.toPublicRoom(room),
          progress: getTaskProgress(room),
          completedTaskId: null,
          advancedTaskId: task.id,
          stageIndex: task.stageIndex,
          winner: evaluateVictory(room),
        };
      }
    }

    // Final stage done (or bot shortcut): mark completed for good.
    if (skipProximity && stages.length > 1) {
      const last = stages[stages.length - 1];
      task.stageIndex = stages.length - 1;
      task.roomId = last.roomId;
      task.roomName = last.roomName;
      task.roomType = last.roomType;
      task.x = last.x;
      task.y = last.y;
    }
    task.completed = true;
    task.completedAt = new Date().toISOString();
    room.updatedAt = task.completedAt;

    return {
      room: this.toPublicRoom(room),
      progress: getTaskProgress(room),
      completedTaskId: task.id,
      winner: evaluateVictory(room),
    };
  }

  /**
   * Starts a meeting. The meeting runs in two phases inside the MEETING
   * status: DISCUSSION first (no voting), then VOTING. Phase transitions
   * are driven by advanceMeeting(); timers live in the socket layer.
   */
  startMeeting(code, reporterId) {
    return this.reportBody(code, reporterId);
  }

  // ------------------------------------------------------------ sabotage //

  /** Sabotage cycle order for the impostor button. */
  #nextSabotageType(room) {
    const allowed = this.#sabotageTypesFor(room);
    return allowed[(room.sabotageCount ?? 0) % allowed.length];
  }

  /**
   * Which sabotages the mapped rooms support: criticals first.
   * LIGHTS needs an ELECTRICAL room, COMMS a COMMUNICATIONS room.
   */
  #sabotageTypesFor(room) {
    const types = (room.map?.rooms ?? []).map((room) => room.type);
    const allowed = [];
    if (types.includes('REACTOR')) allowed.push('REACTOR');
    if (types.includes('O2')) allowed.push('O2');
    if (types.includes('ELECTRICAL')) allowed.push('LIGHTS');
    if (types.includes('COMMUNICATIONS')) allowed.push('COMMS');
    return allowed;
  }

  static SABOTAGE_META = Object.freeze({
    REACTOR: { label: 'Reactor Meltdown', critical: true },
    O2: { label: 'Oxygen Depleted', critical: true },
    LIGHTS: { label: 'Lights Off', critical: false },
    COMMS: { label: 'Comms Down', critical: false },
  });

  /**
   * Impostor sabotage. Critical rounds (REACTOR/O2) run a 30 s countdown
   * that wins the game for the impostors when it expires. LIGHTS and
   * COMMS are soft sabotages without deadline; they disable corpse
   * spotting (visibility) or the task list until the crew fixes them.
   * An active soft sabotage can be replaced by a new one.
   */
  startSabotage(code, playerId, requestedType = null) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);
    assertKnownPlayer(room, playerId);

    const impostor = getPlayer(room, playerId);
    if (!impostor || impostor.role !== ROLE_IMPOSTOR || !impostor.isAlive) {
      throw new GameError('SABOTAGE_REJECTED', 'Only an alive impostor can sabotage.');
    }
    const active = room.sabotage;
    const activeCritical = active?.deadline != null;
    if (active && activeCritical) {
      throw new GameError('SABOTAGE_ACTIVE', 'A critical sabotage is already running.');
    }
    const cooldownLeft = (room.sabotageCooldownUntil ?? 0) - Date.now();
    if (active && cooldownLeft > 0) {
      throw new GameError(
        'SABOTAGE_COOLDOWN',
        `Sabotage bereit in ${Math.ceil(cooldownLeft / 1000)}s.`,
        { retryInMs: cooldownLeft },
      );
    }
    if (!active && cooldownLeft > 0) {
      throw new GameError(
        'SABOTAGE_COOLDOWN',
        `Sabotage bereit in ${Math.ceil(cooldownLeft / 1000)}s.`,
        { retryInMs: cooldownLeft },
      );
    }

    const allowed = this.#sabotageTypesFor(room);
    let type;
    if (requestedType != null) {
      if (!allowed.includes(requestedType)) {
        throw new GameError(
          'SABOTAGE_UNAVAILABLE',
          'Diese Sabotage passt nicht zu den R\u00e4umen (\u00c4nderung der Karte).',
          { field: 'sabotage' },
        );
      }
      type = requestedType;
    } else {
      type = this.#nextSabotageType(room);
    }
    room.sabotageCount = (room.sabotageCount ?? 0) + 1;

    const isCritical = RoomStore.SABOTAGE_META[type].critical;
    // 30 s meltdown / depletion — enough panic, short enough for real play.
    const deadlineMs = isCritical ? Date.now() + 30_000 : null;
    room.sabotage = {
      type,
      deadline: deadlineMs != null ? new Date(deadlineMs).toISOString() : null,
      panels: type === 'O2' ? { o2: false, admin: false } : null,
    };
    // Cooldown for the NEXT sabotage: after a critical ends (+15 s mercy),
    // non-critical ones self-limit with 45 s ready time.
    room.sabotageCooldownUntil = deadlineMs != null
      ? deadlineMs + 15_000
      : Date.now() + 45_000;
    room.updatedAt = new Date().toISOString();

    return { room: this.toPublicRoom(room), type, deadline: room.sabotage.deadline };
  }

  /** Crew fix at a panel: REACTOR (available) / O2 / ADMIN. */
  fixSabotagePanel(code, playerId, panel, { skipPresenceCheck = false } = {}) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);

    const sab = room.sabotage;
    if (!sab) {
      throw new GameError('NO_SABOTAGE', 'Nothing to fix right now.');
    }
    if (sab.deadline != null && new Date(sab.deadline).getTime() <= Date.now()) {
      throw new GameError('SABOTAGE_EXPIRED', 'Too late — the countdown already ran out.');
    }
    if (
      !skipPresenceCheck &&
      this.#playerInSabotageFixRoom(code, playerId, sab, panel) !== true
    ) {
      throw new GameError(
        'SABOTAGE_NOT_AT_PANEL',
        'Du musst im passenden Raum stehen (Reactor/O2/Admin).',
      );
    }
    if (sab.panels && sab.panels[panel]) {
      throw new GameError('SABOTAGE_ALREADY_FIXED', 'This panel is already fixed.');
    }

    if (sab.type === 'REACTOR') {
      // Among Us rule: two area members must fix TOGETHER — a second alive
      // crewmate must be standing in the reactor with the presser.
      const helpers = this.#aliveCrewInRoom(code, 'REACTOR', playerId);
      if (!skipPresenceCheck && helpers.length < 1) {
        throw new GameError(
          'SABOTAGE_NEED_HELP',
          'Zwei Crewmates m\u00fcssen im Reactor stehen, um zusammen zu fixen!',
        );
      }
      this.#clearSabotage(code, room);
      return { room: this.toPublicRoom(room), fixed: ['REACTOR'] };
    }

    if (sab.type === 'O2') {
      // O2: two panels — fix panel at O2 and Admin rooms.
      sab.panels[panel] = true;
      if (sab.panels.o2 && sab.panels.admin) {
        this.#clearSabotage(code, room);
        return { room: this.toPublicRoom(room), fixed: ['o2', 'admin'] };
      }
      room.updatedAt = new Date().toISOString();
      return { room: this.toPublicRoom(room), fixed: [panel] };
    }

    // LIGHTS / COMMS: single press at the fitting panel.
    this.#clearSabotage(code, room);
    return { room: this.toPublicRoom(room), fixed: [sab.type] };
  }

  /** True when a CRITICAL sabotage ran out; used by the socket timers. */
  isSabotageExpired(code) {
    const room = this.getRoom(code);
    if (!room?.sabotage?.deadline) return false;
    return new Date(room.sabotage.deadline).getTime() <= Date.now();
  }

  #clearSabotage(code, room) {
    const type = room.sabotage?.type;
    room.sabotage = null;
    room.updatedAt = new Date().toISOString();
    return { room: this.toPublicRoom(room), clearedType: type };
  }

  #roomPolygonByType(room, type) {
    return (room.map?.rooms ?? []).find((candidate) => candidate.type === type) ?? null;
  }

  #playerRoomIdByType(code, playerId, type) {
    const room = this.getRoom(code);
    const own = this.#positions.get(code)?.get(playerId);
    const polygon = this.#roomPolygonByType(room, type);
    if (!own || !polygon) return false;
    return own.roomId === polygon.id && pointInPolygon(own.x, own.y, polygon.polygon);
  }

  #playerInSabotageFixRoom(code, playerId, sab, panel) {
    let neededType;
    if (sab.type === 'REACTOR') neededType = 'REACTOR';
    else if (sab.type === 'O2') neededType = panel === 'o2' ? 'O2' : 'ADMIN';
    else if (sab.type === 'LIGHTS') neededType = 'ELECTRICAL';
    else neededType = 'COMMUNICATIONS';
    return this.#playerRoomIdByType(code, playerId, neededType);
  }

  #aliveCrewInRoom(code, type, excludeId) {
    const room = this.getRoom(code);
    if (!room) return [];
    const result = [];
    for (const player of room.players) {
      if (player.id === excludeId || !player.isAlive || player.role === ROLE_IMPOSTOR) continue;
      if (this.#playerRoomIdByType(code, player.id, type)) result.push(player.id);
    }
    return result;
  }

  // -------------------------------------------------- emergency meeting //

  /** One emergency meeting per player per game: standing in Cafeteria. */
  emergencyMeeting(code, playerId) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);
    assertKnownPlayer(room, playerId);

    if (!isPlayerAlive(room, playerId)) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot call meetings.');
    }
    const used = room.emergencyUsed ?? {};
    used[playerId] ??= 0;
    if (used[playerId] >= room.config.emergencyMeetingsPerPlayer) {
      throw new GameError(
        'NO_EMERGENCY_LEFT',
        'Dein Notfall-Button ist f\u00fcr diese Runde aufgebraucht.',
      );
    }
    if (!this.#playerRoomIdByType(code, playerId, 'CAFETERIA')) {
      throw new GameError(
        'NOT_IN_CAFETERIA',
        'Der Notfall-Button funktioniert nur in der Cafeteria.',
      );
    }
    used[playerId] += 1;
    room.emergencyUsed = used;

    const now = Date.now();
    room.meeting = {
      reporterId: playerId,
      phase: 'DISCUSSION',
      discussionEndsAt: new Date(now + room.config.discussionDurationMs).toISOString(),
      votingEndsAt: null,
      votes: {},
      emergency: true,
    };
    delete room.sabotage; // a meeting resets soft sabotages (Among Us rule)
    room.status = getEnumValue(RoomStatus, 'MEETING');
    room.updatedAt = new Date().toISOString();

    return {
      room: this.toPublicRoom(room),
      reporterId: playerId,
      phase: room.meeting.phase,
      discussionDeadline: room.meeting.discussionEndsAt,
    };
  }

  reportBody(code, reportingPlayerId) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);
    assertKnownPlayer(room, reportingPlayerId);

    if (!isPlayerAlive(room, reportingPlayerId)) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot report bodies.');
    }

    // A corpse must have been discovered from the same street (server
    // computed during position updates); this is the discovery gate.
    const visible = this.visibleCorpses(code, reportingPlayerId);
    if (!visible.length) {
      throw new GameError(
        'NO_BODY_NEARBY',
        'Keine Leiche entdeckt \u2014 du musst dich auf derselben Stra\u00dfe befinden.',
      );
    }

    const now = Date.now();
    room.meeting = {
      reporterId: reportingPlayerId,
      phase: 'DISCUSSION',
      discussionEndsAt: new Date(now + room.config.discussionDurationMs).toISOString(),
      votingEndsAt: null,
      votes: {},
    };
    delete room.sabotage; // a meeting resets soft sabotages (Among Us rule)
    room.status = getEnumValue(RoomStatus, 'MEETING');
    room.updatedAt = new Date().toISOString();

    return {
      room: this.toPublicRoom(room),
      reporterId: reportingPlayerId,
      phase: room.meeting.phase,
      discussionDeadline: room.meeting.discussionEndsAt,
    };
  }

  /**
   * Moves an active meeting forward:
   * DISCUSSION -> VOTING (returns type PHASE) or VOTING -> RESULT
   * (returns type RESULT). Safe against stale/double timer fires.
   */
  advanceMeeting(code) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MEETING || !room.meeting) {
      throw new GameError('NOT_IN_MEETING', 'There is no active meeting.');
    }

    if (room.meeting.phase === 'DISCUSSION') {
      room.meeting.phase = 'VOTING';
      room.meeting.votingEndsAt = new Date(
        Date.now() + room.config.votingDurationMs,
      ).toISOString();
      room.updatedAt = room.meeting.votingEndsAt;

      return {
        type: 'PHASE',
        room: this.toPublicRoom(room),
        votingDeadline: room.meeting.votingEndsAt,
      };
    }

    // VOTING phase expired.
    const result = this.endMeeting(code);
    return { type: 'RESULT', ...result };
  }

  castVote(code, voterId, { targetId, skip = false } = {}) {
    const room = this.getRequiredRoom(code);
    assertKnownPlayer(room, voterId);

    if (
      room.status !== STATUS_MEETING ||
      !room.meeting ||
      room.meeting.phase !== 'VOTING'
    ) {
      throw new GameError(
        'VOTING_NOT_OPEN',
        'Votes are only accepted during the voting phase.',
      );
    }

    if (!isPlayerAlive(room, voterId)) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot vote.');
    }

    if (voterId in room.meeting.votes) {
      throw new GameError('ALREADY_VOTED', 'Each player can only vote once.');
    }

    const choice = skip ? 'skip' : targetId;

    if (choice !== 'skip') {
      if (!isNonEmptyString(choice)) {
        throw new GameError('INVALID_VOTE', 'A vote must target a player or be a skip.');
      }
      const target = getPlayer(room, choice);
      if (!target || !target.isAlive) {
        throw new GameError('INVALID_TARGET', 'Vote target must be an alive player.');
      }
    }

    room.meeting.votes[voterId] = choice;
    room.updatedAt = new Date().toISOString();

    const totalVoters = countAlivePlayers(room);
    const votedCount = Object.keys(room.meeting.votes).length;

    return {
      room: this.toPublicRoom(room),
      votedCount,
      totalVoters,
      everyoneVoted: votedCount >= totalVoters,
    };
  }

  /**
   * Tallies the votes, ejects the strictly most-voted alive player
   * (ties/skip majority eject nobody), restores IN_GAME and evaluates win
   * conditions. Callers broadcast the result and trigger endGame() when a
   * winner is returned.
   */
  endMeeting(code) {
    const room = this.getRequiredRoom(code);

    if (
      room.status !== STATUS_MEETING ||
      !room.meeting ||
      room.meeting.phase !== 'VOTING'
    ) {
      throw new GameError('NOT_IN_MEETING', 'There is no open voting to end.');
    }

    const tally = {};
    for (const choice of Object.values(room.meeting.votes)) {
      tally[choice] = (tally[choice] ?? 0) + 1;
    }

    let ejectedPlayerId = null;
    let topCount = 0;
    let tie = false;
    for (const [choice, count] of Object.entries(tally)) {
      if (count > topCount) {
        topCount = count;
        ejectedPlayerId = choice === 'skip' ? null : choice;
        tie = false;
      } else if (count === topCount && count > 0) {
        tie = true;
        ejectedPlayerId = null;
      }
    }
    if (tie) {
      ejectedPlayerId = null;
    }

    let ejectedPlayerName = null;
    let ejectedRole = null;
    if (ejectedPlayerId) {
      const ejected = getPlayer(room, ejectedPlayerId);
      if (ejected && ejected.isAlive) {
        ejected.isAlive = false;
        room.ejectedPlayerIds = [...(room.ejectedPlayerIds ?? []), ejected.id];
        ejectedPlayerName = ejected.name;
        ejectedRole = ejected.role;
      } else {
        ejectedPlayerId = null;
      }
    }

    // Vote-Reveal (Divo): wer hat wen gewählt — nur bei nicht-anonymem
    // Voting. Anonym lädt der Client graue Platzhalter statt Namen.
    // BEFORE delete: die Votes leben nur in room.meeting.
    const meetingVotes = { ...(room.meeting?.votes ?? {}) };
    const revealVotes = room.config.anonymousVoting
      ? null
      : Object.entries(meetingVotes).map(([voterId, choice]) => {
        const voter = getPlayer(room, voterId);
        const targetPlayer = choice !== 'skip' ? getPlayer(room, choice) : null;
        return {
          voterId,
          voterName: voter?.name ?? voterId,
          voterColorId: voter?.colorId ?? 'gray',
          targetId: choice,
          targetName: targetPlayer?.name ?? 'Skip',
        };
      });

    const winner = evaluateVictory(room);
    delete room.meeting;
    room.status = getEnumValue(RoomStatus, 'IN_GAME');
    room.updatedAt = new Date().toISOString();

    const impostorsRemaining = room.players.filter(
      (p) => p.role === ROLE_IMPOSTOR && p.isAlive,
    ).length;

    const payload = {
      room: this.toPublicRoom(room),
      ejectedPlayerId,
      ejectedRole,
      impostorsRemaining,
      revealVotes,
      winner,
    };

    if (room.config.confirmEjects) {
      payload.ejectedPlayerName = ejectedPlayerName;
    }
    if (!room.config.anonymousVoting) {
      payload.tally = tally;
    }

    return payload;
  }

  killPlayer(code, killerPlayerId, targetPlayerId) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);

    const killer = getPlayer(room, killerPlayerId);
    if (!killer || killer.role !== ROLE_IMPOSTOR) {
      throw new GameError('NOT_IMPOSTOR', 'Only impostors can kill.');
    }

    if (!killer.isAlive) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot kill.');
    }

    // PROXIMITY HOOK: a future zone/proximity check for real-life play
    // slots in here (server-verified zone membership of killer & target).

    if (room.config.killCooldownMs > 0) {
      const sinceLastKill = Date.now() - (room.lastKillAt ?? 0);
      if (sinceLastKill < room.config.killCooldownMs) {
        throw new GameError(
          'KILL_ON_COOLDOWN',
          'The impostor needs to wait before killing again.',
          { retryAfterMs: room.config.killCooldownMs - sinceLastKill },
        );
      }
    }

    const target = getPlayer(room, targetPlayerId);
    if (!target || !target.isAlive) {
      throw new GameError('INVALID_TARGET', 'Kill target must be an alive player.');
    }

    if (target.id === killer.id) {
      throw new GameError('INVALID_TARGET', 'The impostor cannot kill themselves.');
    }

    // Real-life kill: the impostor must PHYSICALLY be at the target
    // (both GPS positions verified by the server, radius configurable).
    const killPositions = this.#positions.get(code);
    const killerPos = killPositions?.get(killer.id);
    const targetPos = killPositions?.get(target.id);
    if (!killerPos || !targetPos) {
      throw new GameError(
        'POSITION_MISSING',
        'Der Kill braucht GPS-Positionen von dir und dem Ziel.',
        { field: 'positions' },
      );
    }
    const check = canKill({
      killerPos,
      targetPos,
      maxDistance: room.config.killRadiusM,
    });
    if (!check.allowed) {
      throw new GameError(
        check.reason === 'TOO_FAR' ? 'TARGET_TOO_FAR' : 'KILL_REJECTED',
        check.reason === 'TOO_FAR'
          ? `Ziel ist zu weit entfernt (${Math.round(check.distance)}m, Radius ${room.config.killRadiusM}m).`
          : check.reason,
        { distance: check.distance, maxDistance: room.config.killRadiusM },
      );
    }

    target.isAlive = false;
    room.lastKillAt = Date.now();

    // Corpse stays exactly where it was killed; EVERY role that ends up on
    // the same street can discover and report it (self-report possible).
    room.corpses ??= [];
    room.corpses.push({
      playerId: target.id,
      x: targetPos.x,
      y: targetPos.y,
      corridorId: targetPos.corridorId ?? null,
      roomId: targetPos.roomId,
      deadAt: new Date().toISOString(),
    });
    room.updatedAt = new Date().toISOString();

    return {
      room: this.toPublicRoom(room),
      killedPlayerId: target.id,
      winner: evaluateVictory(room),
    };
  }

  /**
   * Rematch: resets a FINISHED game back into the lobby. Identity data
   * (code, host, players incl. order/join order, session tokens, config)
   * is preserved; all round data (roles, aliveness, tasks, ejections,
   * meeting leftovers, cooldowns) is discarded.
   */
  resetToLobby(code) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_GAME_OVER) {
      throw new GameError(
        'INVALID_PHASE',
        'Only a finished game can be reset to the lobby.',
      );
    }

    for (const player of room.players) {
      player.role = ROLE_CREWMATE; // placeholder; fresh roles on start
      player.isAlive = true;
    }

    delete room.winner;
    delete room.meeting;
    room.tasks = [];
    room.ejectedPlayerIds = [];
    room.lastKillAt = 0;
    room.corpses = [];
    delete room.sabotage;
    room.sabotageCount = 0;
    delete room.sabotageCooldownUntil;
    room.emergencyUsed = {};
    // A saved map survives rematches (the real building does not change):
    room.status = room.map ? STATUS_MAP_READY : STATUS_LOBBY;
    room.updatedAt = new Date().toISOString();

    // Clear positions and admin auth for privacy on rematch
    this.#positions.delete(code);
    this.#clearBoundaryStrikes(code);
    this.revokeAllAdmin(code);

    return this.toPublicRoom(room);
  }

  // ------------------------------------------------------------- map setup //

  /**
   * Host opens map setup from the lobby. Creates an empty authoritative map
   * (kept across reconnects) and switches the room to MAP_SETUP.
   */
  startMapSetup(code) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_LOBBY) {
      throw new GameError(
        'INVALID_PHASE',
        'Map setup can only be started from the lobby.',
      );
    }
    if (!room.map) {
      room.map = {
        version: 1,
        nodes: [],
        corridors: [],
        rooms: [],
        connections: [],
      };
    }
    room.status = STATUS_MAP_SETUP;
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  /**
   * Host re-calibrates ONLY the GPS anchor of a saved map — allowed while
   * warm (MAP_READY) and even IN GAME (real-life recalibration on the
   * cafeteria spot). Nodes/corridors/rooms stay untouched.
   */
  setMapAnchor(code, anchor) {
    const room = this.getRequiredRoom(code);

    if (!room.map) {
      throw new GameError('MAP_MISSING', 'The room has no map yet.');
    }
    if (room.status !== STATUS_MAP_READY && room.status !== STATUS_IN_GAME) {
      throw new GameError(
        'MAP_LOCKED',
        'Der Setz-Punkt ist nur im Spiel oder bei fertigem Satz m\u00f6glich.',
      );
    }
    const lat = Number(anchor?.lat);
    const lon = Number(anchor?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new GameError(
        'MAP_ANCHOR_INVALID',
        'Der Setz-Punkt braucht g\u00fcltige GPS-Koordinaten (lat/lon).',
      );
    }
    room.map.anchor = { lat, lon };
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  /**
   * Host stores the PERMANENT two-point calibration (Divo-Geburtstags-
   * Wunsch: einmal kalibrieren, künftig Spiel starten ohne laufen).
   * Allowed in every map phase incl. in-game (fine-tuning on the spot).
   */
  setMapCal(code, rawCal) {
    const room = this.getRequiredRoom(code);

    if (!room.map) {
      throw new GameError('MAP_MISSING', 'The room has no map yet.');
    }
    if (room.status !== STATUS_MAP_SETUP && room.status !== STATUS_MAP_READY
      && room.status !== STATUS_IN_GAME) {
      throw new GameError(
        'MAP_LOCKED',
        'Kalibrieren ist nur bei Kartenbau, Start oder im Spiel m\u00f6glich.',
      );
    }
    const cal = sanitizeCal(rawCal);
    if (!cal) {
      throw new GameError(
        'MAP_ANCHOR_INVALID',
        'Kalibrierung braucht zwei deutlich auseinanderliegende Punkte mit GPS-Koordinaten.',
      );
    }
    room.map.cal = cal;
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  /**
   * Host pushes a full atomic map snapshot while editing. Only possible
   * during MAP_SETUP; the version is assigned by saveMap().
   */
  updateMap(code, rawMap) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MAP_SETUP && room.status !== STATUS_MAP_READY) {
      throw new GameError(
        'MAP_LOCKED',
        'The map can only be edited during map setup or when the map is ready.',
      );
    }

    const sanitized = sanitizeGameMap(rawMap ?? {});
    // Divo-Regel: pro Raum-Typ existiert GENAU EIN Raum (NORMAL/Fort
    // beliebig oft). Deletes stay first — duplicates are dropped so the
    // rule self-heals his existing map instead of locking it.
    const seenTypes = new Set();
    const deduped = sanitized.rooms.filter((room) => {
      if (room.type === 'NORMAL') return true;
      if (seenTypes.has(room.type)) return false;
      seenTypes.add(room.type);
      return true;
    });
    sanitized.rooms = deduped;
    sanitized.version = room.map?.version ?? 1;
    // Kalibrierungsschutz (Divo-Feldtest 30.10): der Editor snapshot
    // transportiert cal nicht — ohne Übernahme würde jede map:update-/
    // save-Zelle die gespeicherte 2-Punkt-Kalibrierung LÖSCHEN und die
    // App würde nach jedem Speichern "bitte kalibrieren" brüllen.
    if (!sanitized.cal && room.map?.cal) {
      sanitized.cal = room.map.cal;
    }
    room.map = sanitized;
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  /**
   * Host saves the map: validates minimum requirements, bumps the version,
   * switches the room to MAP_READY so the game can start.
   */
  saveMap(code, rawMap) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MAP_SETUP && room.status !== STATUS_MAP_READY) {
      throw new GameError(
        'MAP_LOCKED',
        'The map can only be saved during map setup or when the map is ready.',
      );
    }

    const source = rawMap === undefined ? room.map : rawMap;
    const sanitized = sanitizeGameMap(source ?? {});
    validateForSave(sanitized);

    const previousVersion = room.map?.version ?? 0;
    sanitized.version = previousVersion + 1;
    // Kalibrierungsschutz: siehe updateMap — Editor-Snapshots haben kein cal.
    if (!sanitized.cal && room.map?.cal) {
      sanitized.cal = room.map.cal;
    }
    room.map = sanitized;
    room.status = STATUS_MAP_READY;
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  /**
   * Host reopens editing of a saved map (MAP_READY -> MAP_SETUP). The map
   * stays intact; version increases again on the next save.
   */
  beginMapEdit(code) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MAP_READY) {
      throw new GameError(
        'INVALID_PHASE',
        'Editing is only possible after the map has been saved.',
      );
    }
    room.status = STATUS_MAP_SETUP;
    room.updatedAt = new Date().toISOString();
    return this.toPublicRoom(room);
  }

  // ----------------------------------------------------------- positioning //

  /**
   * Updates a player's position. Server-authoritative: validates phase,
   * sanitizes input, computes map matching and room membership.
   *
   * @returns {{ position: {x,y,heading,confidence,source,timestamp}, roomId: string|null, onCorridor: boolean }}
   */
  updatePosition(code, playerId, rawEstimate, { skipPlausibilityCheck = false } = {}) {
    const room = this.getRequiredRoom(code);

    // Position updates allowed in MAP_READY and IN_GAME
    if (room.status !== STATUS_MAP_READY && room.status !== STATUS_IN_GAME) {
      throw new GameError(
        'POSITION_NOT_ALLOWED',
        'Position updates are only allowed when the map is ready or the game is running.',
        { currentStatus: room.status },
      );
    }

    assertKnownPlayer(room, playerId);

    const estimate = sanitizePositionEstimate(rawEstimate);

    // Initialize position store for this room if needed
    if (!this.#positions.has(code)) {
      this.#positions.set(code, new Map());
    }
    const roomPositions = this.#positions.get(code);
    const previous = roomPositions.get(playerId) || null;

    // Temporal/spatial plausibility check
    const plausibility = skipPlausibilityCheck
      ? { valid: true }
      : isPositionPlausible(estimate, previous);
    if (!plausibility.valid) {
      throw new GameError(
        plausibility.reason,
        `Position update rejected: ${plausibility.reason}`,
        plausibility.details,
      );
    }

    // Map matching: resolve room membership and snap to corridors
    const matching = resolveRoomMembership(
      estimate.x, estimate.y,
      room.map,
    );

    // Store authoritative position
    const snap = snapToCorridor(estimate.x, estimate.y, room.map);
    const positionState = {
      x: estimate.x,
      y: estimate.y,
      heading: estimate.heading,
      confidence: estimate.confidence,
      source: estimate.source,
      timestamp: estimate.timestamp,
      // Server-computed fields
      roomId: matching.roomId,
      onCorridor: matching.onCorridor,
      // Street identity for the same-street corpse discovery rule.
      corridorId: matching.roomId ? null : snap?.corridorId ?? null,
      snappedX: matching.snappedX,
      snappedY: matching.snappedY,
      updatedAt: Date.now(),
    };

    roomPositions.set(playerId, positionState);
    room.updatedAt = new Date().toISOString();

    const bodies = this.visibleCorpses(code, playerId);

    // Boundary watch: how far outside every selected street is the player?
    const distanceOutM =
      room.map?.corridors?.length
        ? nearestCorridorDistanceM(
            positionState.x,
            positionState.y,
            room.map.nodes ?? [],
            room.map.corridors,
          )
        : 0;
    const boundaryKey = `${code}|${playerId}`;
    const strikes = this.#boundaryStrikes.get(boundaryKey) ?? { strikes: 0, alerted: false };
    // Grenz-Eskalation (Draußen-Regel von Divo): 60s Frist, dann 120s
    // Frist, danach Dauer-Alarm an den Host — bis der Spieler drin ist.
    // Draußen-Fristen (Divo-Regel): 60s dann 120s dann Host-Alarm.
    // Env-Override hilft Tests, nicht 3 Minuten zu warten.
    const ESCALATION = {
      FIRST: Number(process.env.RLAUS_ESCALATION_FIRST_MS ?? 60_000),
      SECOND: Number(process.env.RLAUS_ESCALATION_SECOND_MS ?? 180_000),
    };
    let escalation = this.#boundaryEscalation.get(boundaryKey)
      ?? { outSince: null, maxLevel: 0 };
    const isOut = room.status === STATUS_IN_GAME && distanceOutM > room.config.boundaryWarnM;
    if (isOut) {
      escalation.outSince ??= Date.now();
    }
    const outMs = isOut ? Date.now() - (escalation.outSince ?? Date.now()) : 0;
    const level = isOut
      ? (outMs >= ESCALATION.SECOND ? 3 : (outMs >= ESCALATION.FIRST ? 2 : 1))
      : 0;
    if (level > (escalation.maxLevel ?? 0)) escalation.maxLevel = level;
    // Zurück-Hinweis: nur relevant, wenn er schon Stufe 2+ erreicht hat.
    const backFromEscalation = !isOut && (escalation.maxLevel ?? 0) >= 2;
    if (!isOut) escalation = { outSince: null, maxLevel: 0 };
    this.#boundaryEscalation.set(boundaryKey, escalation);
    // Host-Alert während Stufe 3 jeden Tick senden (Client hält Banner).
    const adminAlert = level >= 3;
    if (
      room.status === STATUS_IN_GAME &&
      distanceOutM > room.config.boundaryWarnM
    ) {
      strikes.strikes += 1;
    } else {
      strikes.strikes = 0;
      strikes.alerted = false;
    }
    if (adminAlert) strikes.alerted = true;
    this.#boundaryStrikes.set(boundaryKey, strikes);

    return {
      position: {
        x: positionState.x,
        y: positionState.y,
        heading: positionState.heading,
        confidence: positionState.confidence,
        source: positionState.source,
        timestamp: positionState.timestamp,
      },
      roomId: positionState.roomId,
      onCorridor: positionState.onCorridor,
      bodies,
      boundary: {
        outOfBounds: isOut,
        distanceM: Math.round(distanceOutM * 10) / 10,
        limitM: room.config.boundaryWarnM,
        strikes: strikes.strikes,
        escalationLevel: level,
        backFromEscalation,
        adminAlert,
      },
    };
  }

  /**
   * Kill targets for an alive impostor: alive crewmates within the
   * configured kill radius (mirrors canKill without cooldown checking —
   * cooldown gates remain in killPlayer).
   */
  getKillTargetsFor(code, playerId) {
    const room = this.getRoom(code);
    if (!room || room.status !== STATUS_IN_GAME) return [];
    const killer = getPlayer(room, playerId);
    if (!killer || killer.role !== ROLE_IMPOSTOR || !killer.isAlive) {
      return [];
    }
    const positions = this.#positions.get(code);
    const own = positions?.get(playerId);
    if (!own) return [];
    const maxDistance = room.config.killRadiusM;
    const targets = [];
    for (const player of room.players) {
      if (player.id === playerId || !player.isAlive || player.role === ROLE_IMPOSTOR) {
        continue;
      }
      const targetPos = positions.get(player.id);
      if (!targetPos) continue;
      const check = canKill({
        killerPos: { x: own.x, y: own.y, confidence: own.confidence },
        targetPos: { x: targetPos.x, y: targetPos.y, confidence: targetPos.confidence },
        maxDistance,
      });
      if (check.allowed) {
        targets.push({ playerId: player.id, name: player.name, distanceM: Math.round(check.distance ?? 0) });
      }
    }
    targets.sort((a, b) => a.distanceM - b.distanceM);
    return targets;
  }

  /**
   * Corpses the given player can discover: those lying on the same street
   * (same corridor) or in the same map room. Shared by every role so
   * impostors can self-report.
   */
  visibleCorpses(code, playerId) {
    const room = this.getRoom(code);
    if (!room) return [];
    const corpses = room.corpses ?? [];
    if (room.status !== STATUS_IN_GAME && room.status !== STATUS_MEETING) {
      return [];
    }
    const own = this.#positions.get(code)?.get(playerId);
    if (!own) return [];
    // Lights sabotage: nobody spots bodies in the dark (Among Us vision rule).
    if (room.sabotage?.type === 'LIGHTS') return [];
    return corpses
      .filter(
        (corpse) =>
          (corpse.corridorId != null && corpse.corridorId === own.corridorId) ||
          (corpse.roomId != null && corpse.roomId === own.roomId),
      )
      .map(({ playerId, x, y, deadAt }) => ({ playerId, x, y, deadAt }));
  }

  /**
   * Returns a player's own position. Only used for the position:confirmed
   * event sent back to the owning socket.
   */
  getPlayerPosition(code, playerId) {
    const roomPositions = this.#positions.get(code);
    if (!roomPositions) return null;
    const pos = roomPositions.get(playerId);
    if (!pos) return null;
    return {
      x: pos.x,
      y: pos.y,
      heading: pos.heading,
      confidence: pos.confidence,
      source: pos.source,
      timestamp: pos.timestamp,
      roomId: pos.roomId,
      onCorridor: pos.onCorridor,
    };
  }

  /**
   * Returns all player positions for admin tracking.
   * Only accessible by authenticated admin sockets.
   */
  getAdminPositions(code) {
    const roomPositions = this.#positions.get(code);
    if (!roomPositions) return [];

    const room = this.getRoom(code);
    if (!room) return [];

    const result = [];
    for (const [playerId, pos] of roomPositions) {
      const player = getPlayer(room, playerId);
      result.push({
        playerId,
        name: player?.name ?? playerId,
        isAlive: player?.isAlive ?? false,
        x: pos.x,
        y: pos.y,
        heading: pos.heading,
        confidence: pos.confidence,
        source: pos.source,
        roomId: pos.roomId,
        onCorridor: pos.onCorridor,
        timestamp: pos.timestamp,
      });
    }
    return result;
  }

  // ----------------------------------------------------------- admin auth //

  /**
   * Sets the admin PIN for a room. Only the host can set this.
   * The PIN is hashed with SHA-256 before storage.
   */
  setAdminPin(code, playerId, pin) {
    const room = this.getRequiredRoom(code);

    if (playerId !== room.hostId) {
      throw new GameError('NOT_ROOM_HOST', 'Only the host can set the admin PIN.');
    }

    if (!pin || typeof pin !== 'string' || pin.length < 4) {
      throw new GameError('INVALID_PIN', 'Admin PIN must be at least 4 characters.');
    }

    room.adminPinHash = hashPin(pin);
    room.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Authenticates the host for admin tracking with a PIN.
   * The PIN is compared against the hashed value stored in the room.
   * If no custom PIN is set, falls back to the room code (backwards compat).
   */
  authenticateAdmin(code, playerId, pin) {
    const room = this.getRequiredRoom(code);

    if (playerId !== room.hostId) {
      throw new GameError('NOT_ROOM_HOST', 'Only the host can become admin.');
    }

    // Rate limit PIN guesses: max 5 attempts per minute per room.
    const now = Date.now();
    const gate = this.#adminAuthAttempts.get(code) ?? { hits: [], lockedUntil: 0 };
    if (now < gate.lockedUntil) {
      throw new GameError(
        'ADMIN_AUTH_FAILED',
        `Zu viele Versuche — warte ${Math.ceil((gate.lockedUntil - now) / 1000)}s.`,
      );
    }

    // Use custom PIN if set, otherwise fall back to room code
    const expectedHash = room.adminPinHash ?? hashPin(code);
    const providedHash = hashPin(pin);

    if (providedHash !== expectedHash) {
      gate.hits = gate.hits.filter((at) => now - at < 60_000);
      gate.hits.push(now);
      if (gate.hits.length >= 5) {
        gate.lockedUntil = now + 60_000;
        gate.hits = [];
      }
      this.#adminAuthAttempts.set(code, gate);
      throw new GameError('ADMIN_AUTH_FAILED', 'Invalid admin PIN.');
    }

    this.#adminAuthAttempts.delete(code);
    if (!this.#adminAuth.has(code)) {
      this.#adminAuth.set(code, new Set());
    }
    this.#adminAuth.get(code).add(playerId);
    return true;
  }

  /**
   * Checks if a player has admin tracking auth for a room.
   */
  isAdmin(code, playerId) {
    return this.#adminAuth.get(code)?.has(playerId) ?? false;
  }

  /**
   * Revokes admin tracking auth (e.g. on rematch/reset).
   */
  revokeAdmin(code, playerId) {
    this.#adminAuth.get(code)?.delete(playerId);
  }

  /**
   * Revokes all admin auth for a room (e.g. on full reset).
   */
  revokeAllAdmin(code) {
    this.#adminAuth.delete(code);
  }

  // ------------------------------------------------------------ reset ext //

  checkWinConditions(code) {
    const room = this.getRequiredRoom(code);
    return evaluateVictory(room);
  }

  endGame(code, winnerRole) {
    const room = this.getRequiredRoom(code);

    if (!PlayerRole.enum.includes(winnerRole)) {
      throw new GameError('INVALID_WINNER', 'Winner must be a valid role.');
    }

    room.status = getEnumValue(RoomStatus, 'GAME_OVER');
    room.winner = winnerRole;
    delete room.meeting;
    room.updatedAt = new Date().toISOString();

    return {
      room: {
        ...this.toPublicRoom(room),
        players: room.players.map(({ id, name, role, isAlive, isHost }) => ({
          id,
          name,
          role,
          isAlive,
          isHost,
        })),
      },
      winner: winnerRole,
    };
  }
}

// Backwards-compatible alias (tests and older modules reference it).
const RoomStoreError = GameError;

function getTaskProgress(room) {
  // Fake tasks (impostors) never count toward the team progress.
  const real = room.tasks.filter((task) => !task.isFake);
  const total = real.length;
  const completed = real.filter((task) => task.completed).length;
  return { completed, total };
}

function countAlivePlayers(room) {
  return room.players.filter((player) => player.isAlive).length;
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) ?? null;
}

function isPlayerAlive(room, playerId) {
  return getPlayer(room, playerId)?.isAlive ?? false;
}

function assertInGame(room) {
  if (room.status !== STATUS_IN_GAME) {
    throw new GameError(
      'NOT_IN_GAME',
      'This action is only allowed while the game is running.',
    );
  }
}

function assertKnownPlayer(room, playerId) {
  if (!isNonEmptyString(playerId) || !getPlayer(room, playerId)) {
    throw new GameError('UNKNOWN_PLAYER', 'You are not part of this room.');
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const MAX_NAME_LEN = 16;

/**
 * Player names come from arbitrary clients and are rendered as text on
 * other devices. NFKC-normalize, strip control characters and cap length
 * so nobody ships control-char tricks or 5kB display bombs.
 */
function sanitizeDisplayName(raw) {
  const value = typeof raw === 'string' ? raw : '';
  const cleaned = value.normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .trim();
  return cleaned.slice(0, MAX_NAME_LEN) || 'Spieler';
}

function isValidPlayer(player) {
  return (
    player &&
    isNonEmptyString(player.id) &&
    isNonEmptyString(player.name) &&
    PlayerRole.enum.includes(player.role)
  );
}

function getEnumValue(enumSchema, value) {
  return enumSchema.enum.find((entry) => entry === value);
}

module.exports = {
  RoomStore,
  RoomStoreError,
  MAX_PLAYERS,
  DEFAULT_GAME_CONFIG,
};

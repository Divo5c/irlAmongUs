const enumsSchema = require('../../../shared/models/enums.schema.json');
const { randomUUID, createHash } = require('node:crypto');
const { GameError } = require('../game/errors');
const {
  DEFAULT_GAME_CONFIG,
  maxImpostorsFor,
  sanitizeGameConfig,
} = require('../game/config');
const { createTasks, groupTasksByPlayer } = require('../game/taskCatalog');
const { evaluateVictory } = require('../game/victory');
const { sanitizeGameMap, validateForSave } = require('../game/map');
const {
  sanitizePositionEstimate,
  resolveRoomMembership,
  isPositionPlausible,
} = require('../game/positioning');

const roomCodePattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const { PlayerRole, RoomStatus } = enumsSchema.$defs;

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

  /** Admin tracking auth: code -> Map<playerId, bool> (authenticated). */
  #adminAuth = new Map();

  /**
   * Base config applied to every newly created room. Rooms may override
   * values at runtime via updateConfig() (host only, lobby only).
   */
  #baseConfig;

  constructor({ config } = {}) {
    this.#baseConfig = sanitizeGameConfig(config ?? {});
  }

  createRoom({ code, hostId, hostName = 'Host', config } = {}) {
    if (!roomCodePattern.test(code) || !isNonEmptyString(hostId)) {
      throw new GameError('INVALID_ROOM', 'A valid room code and host ID are required.');
    }

    if (this.#roomsByCode.has(code)) {
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
      code,
      hostId,
      players: [
        {
          id: hostId,
          name: hostName,
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

    this.#roomsByCode.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.#roomsByCode.get(code) ?? null;
  }

  getRequiredRoom(code) {
    const room = this.getRoom(code);
    if (!room) {
      throw new GameError('ROOM_NOT_FOUND', 'Room not found.');
    }
    return room;
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
      players: room.players.map(({ id, name, isAlive, isHost, joinedAt }) => ({
        id,
        name,
        isAlive,
        isHost,
        joinedAt,
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
      taskProgress: getTaskProgress(room),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
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
        'This game has already started; joining is only possible before it begins.',
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
      isAlive: true,
      isHost: false,
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

    if (room.status !== STATUS_LOBBY) {
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

    room.tasks = createTasks(room.players, room.config.tasksPerCrewmate);
    delete room.winner;
    room.ejectedPlayerIds = [];
    room.lastKillAt = 0;
    delete room.meeting;
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

  completeTask(code, playerId, taskId) {
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

  reportBody(code, reportingPlayerId) {
    const room = this.getRequiredRoom(code);
    assertInGame(room);
    assertKnownPlayer(room, reportingPlayerId);

    if (!isPlayerAlive(room, reportingPlayerId)) {
      throw new GameError('PLAYER_DEAD', 'Dead players cannot report bodies.');
    }

    const now = Date.now();
    room.meeting = {
      reporterId: reportingPlayerId,
      phase: 'DISCUSSION',
      discussionEndsAt: new Date(now + room.config.discussionDurationMs).toISOString(),
      votingEndsAt: null,
      votes: {},
    };
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
    if (ejectedPlayerId) {
      const ejected = getPlayer(room, ejectedPlayerId);
      if (ejected && ejected.isAlive) {
        ejected.isAlive = false;
        room.ejectedPlayerIds = [...(room.ejectedPlayerIds ?? []), ejected.id];
        ejectedPlayerName = ejected.name;
      } else {
        ejectedPlayerId = null;
      }
    }

    const winner = evaluateVictory(room);
    delete room.meeting;
    room.status = getEnumValue(RoomStatus, 'IN_GAME');
    room.updatedAt = new Date().toISOString();

    const payload = {
      room: this.toPublicRoom(room),
      ejectedPlayerId,
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

    target.isAlive = false;
    room.lastKillAt = Date.now();
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
    // A saved map survives rematches (the real building does not change):
    room.status = room.map ? STATUS_MAP_READY : STATUS_LOBBY;
    room.updatedAt = new Date().toISOString();

    // Clear positions and admin auth for privacy on rematch
    this.#positions.delete(code);
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
   * Host pushes a full atomic map snapshot while editing. Only possible
   * during MAP_SETUP; the version is assigned by saveMap().
   */
  updateMap(code, rawMap) {
    const room = this.getRequiredRoom(code);

    if (room.status !== STATUS_MAP_SETUP) {
      throw new GameError(
        'MAP_LOCKED',
        'The map can only be edited during map setup.',
      );
    }

    const sanitized = sanitizeGameMap(rawMap ?? {});
    sanitized.version = room.map?.version ?? 1;
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

    if (room.status !== STATUS_MAP_SETUP) {
      throw new GameError(
        'MAP_LOCKED',
        'The map can only be saved during map setup.',
      );
    }

    const source = rawMap === undefined ? room.map : rawMap;
    const sanitized = sanitizeGameMap(source ?? {});
    validateForSave(sanitized);

    const previousVersion = room.map?.version ?? 0;
    sanitized.version = previousVersion + 1;
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
  updatePosition(code, playerId, rawEstimate) {
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
    const plausibility = isPositionPlausible(estimate, previous);
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
      snappedX: matching.snappedX,
      snappedY: matching.snappedY,
      updatedAt: Date.now(),
    };

    roomPositions.set(playerId, positionState);
    room.updatedAt = new Date().toISOString();

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
    };
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

    // Use custom PIN if set, otherwise fall back to room code
    const expectedHash = room.adminPinHash ?? hashPin(code);
    const providedHash = hashPin(pin);

    if (providedHash !== expectedHash) {
      throw new GameError('ADMIN_AUTH_FAILED', 'Invalid admin PIN.');
    }

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
  const total = room.tasks.length;
  const completed = room.tasks.filter((task) => task.completed).length;
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

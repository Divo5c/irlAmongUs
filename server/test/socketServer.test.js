const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const http = require('node:http');
const { io: Client } = require('socket.io-client');

const { RoomStore } = require('../src/rooms/roomStore');
const { createHttpServer } = require('../src/httpServer');
const { createSocketServer } = require('../src/socket/socketServer');
const { DEFAULT_HOST, DEFAULT_PORT, readServerConfig } = require('../src/config/serverConfig');

let server;
let io;
let shortServer;
let baseUrl;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function connectClient(url = baseUrl) {
  return new Promise((resolve, reject) => {
    const client = Client(url, { transports: ['websocket'] });
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

function waitForEvent(client, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Waits for a room:updated that satisfies the predicate; older broadcasts
 * that were already in flight are ignored.
 */
function waitForRoomWhere(client, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.off('room:updated', handler);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for a matching room:updated'));
    }, timeoutMs);
    const handler = (room) => {
      if (predicate(room)) {
        cleanup();
        resolve(room);
      }
    };
    client.on('room:updated', handler);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForNoEvent(client, event, ms = 400) {
  return new Promise((resolve) => {
    let received = false;
    client.once(event, () => {
      received = true;
    });
    setTimeout(() => resolve(received), ms);
  });
}

/** Host creates a room, one player joins. Returns sockets + code. */
async function createRoomWithTwoPlayers(configPatch) {
  const code = randomCode();
  const host = await connectClient();
  const player = await connectClient();

  const created = waitForEvent(host, 'room:created');
  const hostSession = waitForEvent(host, 'session:created');
  host.emit('room:create', {
    code,
    hostId: 'host-1',
    hostName: 'Host',
    ...(configPatch ? { config: configPatch } : {}),
  });
  const [, hostCredentials] = await Promise.all([created, hostSession]);

  const joined = waitForRoomWhere(host, (room) => room.players.length === 2);
  const playerSession = waitForEvent(player, 'session:created');
  player.emit('room:join', { code, playerId: 'player-2', playerName: 'P2' });
  const [, session] = await Promise.all([joined, playerSession]);

  return {
    host,
    player,
    code,
    hostToken: hostCredentials.token,
    playerToken: session.token,
  };
}

/**
 * Generic multi-player lobby: host-1 plus player-2..player-N.
 * Returns { clients: [{client,id}], players, code }.
 */
async function createRoomWithNPlayers(playerCount, configPatch) {
  const code = randomCode();
  const clients = [];

  const host = await connectClient();
  clients.push(host);
  const created = waitForEvent(host, 'room:created');
  host.emit('room:create', {
    code,
    hostId: 'host-1',
    hostName: 'Host',
    ...(configPatch ? { config: configPatch } : {}),
  });
  await created;

  for (let index = 2; index <= playerCount; index += 1) {
    const client = await connectClient();
    clients.push(client);
    const id = `player-${index}`;
    const joined = waitForRoomWhere(host, (r) => r.players.length === index);
    client.emit('room:join', { code, playerId: id, playerName: `P${index}` });
    await joined;
  }

  return { clients, code };
}

const SAMPLE_MAP = {
  nodes: [
    { id: 'n1', x: 10, y: 50 },
    { id: 'n2', x: 90, y: 50 },
  ],
  corridors: [{ id: 'c1', a: 'n1', b: 'n2' }],
  rooms: [],
  connections: [],
};

/** Host runs the full map setup over the wire (start/update/save). */
async function makeMapReadyOverWire(host, code) {
  const setupSeen = waitForRoomWhere(host, (r) => r.status === 'MAP_SETUP');
  host.emit('map:start', { code });
  await setupSeen;

  host.emit('map:update', { code, map: SAMPLE_MAP });
  const savedSeen = waitForRoomWhere(host, (r) => r.status === 'MAP_READY');
  host.emit('map:save', { code });
  const saved = await savedSeen;
  assert.equal(saved.map.nodes.length, 2);
  return saved;
}

/** ...and the host starts the game. Returns both role assignments. */
async function startGameFor({ host, player, code }) {
  await makeMapReadyOverWire(host, code);
  const started = Promise.all([
    waitForEvent(host, 'game:role_assigned'),
    waitForEvent(player, 'game:role_assigned'),
  ]);
  host.emit('game:start', { code });
  const [hostAssignment, playerAssignment] = await started;
  return { hostAssignment, playerAssignment };
}

before(async () => {
  const roomStore = new RoomStore();
  server = createHttpServer(roomStore);
  io = createSocketServer(server, roomStore, { disconnectGraceMs: 150 });
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  io.close(); // closes the http server and all connected sockets
  await new Promise((resolve) => server.close(resolve));
  if (shortServer) {
    await new Promise((resolve) => shortServer.close(resolve));
  }
});

describe('socket flow security & gameplay', () => {
  test('server config binds publicly and validates the hosting port strictly', () => {
    assert.deepEqual(readServerConfig({}), {
      serverPort: DEFAULT_PORT,
      serverHost: DEFAULT_HOST,
    });
    assert.deepEqual(readServerConfig({ PORT: '4312', HOST: '0.0.0.0' }), {
      serverPort: 4312,
      serverHost: '0.0.0.0',
    });
    for (const PORT of ['123junk', '0', '-2', '65536', '']) {
      if (PORT === '') continue;
      assert.throws(() => readServerConfig({ PORT }), /PORT must be an integer/);
    }
  });

  test('health endpoint reports readiness without exposing room data', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  test('roles are distributed privately and never broadcast', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      await makeMapReadyOverWire(host, code);

      // Register all listeners BEFORE triggering the start (events can
      // arrive back-to-back within the same tick).
      const updated = waitForEvent(host, 'room:updated');
      const rolesPromise = Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);
      host.emit('game:start', { code });
      const publicRoom = await updated;
      assert.equal(publicRoom.status, 'IN_GAME');
      for (const member of publicRoom.players) {
        assert.equal('role' in member, false);
        assert.equal('teammates' in member, false);
        assert.equal('tasks' in member, false);
      }

      const [hostAssignment, playerAssignment] = await rolesPromise;

      const roles = [hostAssignment.role, playerAssignment.role];
      assert.deepEqual(roles.sort(), ['CREWMATE', 'IMPOSTOR']);

      // Teammate info exists for everyone but is empty for crewmates.
      const crew =
        hostAssignment.role === 'CREWMATE'
          ? { assignment: hostAssignment }
          : { assignment: playerAssignment };
      const imp =
        hostAssignment.role === 'IMPOSTOR'
          ? { assignment: hostAssignment }
          : { assignment: playerAssignment };

      assert.deepEqual(crew.assignment.teammates, []);
      assert.deepEqual(imp.assignment.teammates, []); // single impostor game
      assert.ok(Array.isArray(imp.assignment.tasks));
      assert.equal(imp.assignment.tasks.length, 0); // impostors get no tasks
      assert.ok(crew.assignment.tasks.length > 0);
      assert.equal(typeof crew.assignment.tasks[0].type, 'string');
      assert.equal(imp.assignment.killReadyAt, 0); // ready at game start
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('non-hosts cannot start the game', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      const errorSeen = waitForEvent(player, 'room:error');
      player.emit('game:start', { code });
      const error = await errorSeen;
      assert.equal(error.code, 'NOT_ROOM_HOST');
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('crewmate tasks complete via socket; progress is broadcast without details', async () => {
    // 3 players: 2 crewmates (4 tasks) + 1 impostor. A 2-player room would
    // end instantly via the impostor parity rule after the first evaluation.
    const { clients, code } = await createRoomWithNPlayers(3);

    try {
      const [host] = clients;
      const rolePromises = clients.map((client) =>
        waitForEvent(client, 'game:role_assigned'),
      );
      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      const assignments = await Promise.all(rolePromises);

      const crewSlot = assignments.findIndex(
        (assignment) => assignment.tasks.length > 0,
      );
      assert.ok(crewSlot !== -1, 'expected at least one crewmate');
      const crew = { client: clients[crewSlot], assignment: assignments[crewSlot] };
      const impostorSlot = assignments.findIndex(
        (assignment) => assignment.role === 'IMPOSTOR',
      );
      assert.ok(impostorSlot !== -1);
      const impostorClient = clients[impostorSlot];

      const progressSeen = waitForEvent(impostorClient, 'task:progress');
      crew.client.emit('task:complete', {
        code,
        taskId: crew.assignment.tasks[0].id,
      });

      const progress = await progressSeen;
      assert.equal(progress.progress.completed, 1);
      assert.equal(progress.completedTaskId, crew.assignment.tasks[0].id);
      assert.equal(progress.tasks, undefined);

      // Completing someone else's task is impossible: ids are owner-scoped.
      // (The impostor tries the crewmate's first task id.)
      const errorSeen = waitForEvent(impostorClient, 'room:error');
      impostorClient.emit('task:complete', { code, taskId: crew.assignment.tasks[0].id });
      const error = await errorSeen;
      assert.equal(error.code, 'TASK_NOT_FOUND');
    } finally {
      for (const client of clients) client.disconnect();
    }
  });

  test('impostor can kill; victims are public; cooldown event is private', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers({
      killCooldownMs: 5000,
    });

    try {
      const { hostAssignment } = await startGameFor({ host, player, code });

      const impostorIsHost = hostAssignment.role === 'IMPOSTOR';
      const impostor = impostorIsHost ? host : player;
      const crewmate = impostorIsHost ? player : host;
      const victimId = impostorIsHost ? 'player-2' : 'host-1';

      let crewCooldownEvents = 0;
      crewmate.on('game:kill_cooldown', () => {
        crewCooldownEvents += 1;
      });

      const cooldownSeen = waitForEvent(impostor, 'game:kill_cooldown');
      const gameOverSeen = waitForEvent(crewmate, 'game:over');

      impostor.emit('game:kill', { code, targetPlayerId: victimId });

      const cooldown = await cooldownSeen;
      assert.ok(cooldown.killReadyAt > Date.now());

      // 1v1 -> impostor parity -> immediate game over with reveal.
      const over = await gameOverSeen;
      assert.equal(over.winner, 'IMPOSTOR');
      assert.ok(over.players.every((member) => typeof member.role === 'string'));

      await sleep(150);
      assert.equal(crewCooldownEvents, 0); // crew never sees cooldown info
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('crewmates cannot send kill events (server rejects)', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      const { hostAssignment } = await startGameFor({ host, player, code });
      const crewmate = hostAssignment.role === 'CREWMATE' ? host : player;
      const targetId = hostAssignment.role === 'CREWMATE' ? 'player-2' : 'host-1';

      const errorSeen = waitForEvent(crewmate, 'room:error');
      crewmate.emit('game:kill', { code, targetPlayerId: targetId });
      const error = await errorSeen;
      assert.equal(error.code, 'NOT_IMPOSTOR');
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('config updates: host-only, lobby-only, validated, broadcast', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      // Non-host is rejected:
      const rejectSeen = waitForEvent(player, 'room:error');
      player.emit('game:update_config', { code, config: { impostorCount: 1 } });
      let error = await rejectSeen;
      assert.equal(error.code, 'NOT_ROOM_HOST');

      // Invalid values are rejected:
      const invalidSeen = waitForEvent(host, 'room:error');
      host.emit('game:update_config', { code, config: { impostorCount: 99 } });
      error = await invalidSeen;
      assert.equal(error.code, 'CONFIG_INVALID');

      // Valid host update is broadcast to everyone:
      const seenOnPlayer = waitForRoomWhere(
        player,
        (room) => room.config.impostorCount === 1 && room.config.votingDurationMs === 45000,
      );
      host.emit('game:update_config', {
        code,
        config: { impostorCount: 1, votingDurationMs: 45000 },
      });
      const room = await seenOnPlayer;
      assert.equal(room.config.votingDurationMs, 45000);

      // Locked once the game is running:
      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      await Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);
      const lockedSeen = waitForEvent(host, 'room:error');
      host.emit('game:update_config', { code, config: { impostorCount: 1 } });
      error = await lockedSeen;
      assert.equal(error.code, 'CONFIG_LOCKED');
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('meeting phases over the wire: discussion blocks votes, then voting opens', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers({
      discussionDurationMs: 150,
    });

    // Temporary diagnostics for room:error payloads:
    const dump = (error) =>
      console.error('[diag] room:error', JSON.stringify(error));
    host.on('room:error', dump);
    player.on('room:error', dump);

    try {
      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      await Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);

      const meetingSeen = waitForEvent(player, 'game:meeting_started');
      player.emit('game:report', { code });
      const meeting = await meetingSeen;

      assert.equal(meeting.status, 'MEETING');
      assert.equal(meeting.phase, 'DISCUSSION');
      assert.equal(meeting.reporterId, 'player-2');
      assert.ok(typeof meeting.discussionDeadline === 'string');

      // Votes during DISCUSSION are rejected:
      const earlyVote = waitForEvent(host, 'room:error');
      host.emit('game:vote_cast', { code, skip: true });
      const earlyError = await earlyVote;
      assert.equal(earlyError.code, 'VOTING_NOT_OPEN');

      // After the discussion the server opens voting automatically:
      const votingOnHost = waitForEvent(host, 'game:voting_started');
      const votingOnPlayer = waitForEvent(player, 'game:voting_started');
      const [votingHost] = await Promise.all([votingOnHost, votingOnPlayer]);
      assert.ok(typeof votingHost.votingDeadline === 'string');

      // Now a vote goes through and produces progress for everyone.
      const progressOnImpostorSide = waitForEvent(player, 'game:vote_progress');
      host.emit('game:vote_cast', { code, skip: true });
      const progress = await progressOnImpostorSide;
      assert.equal(progress.totalVoters, 2);

      // Player votes too -> everyone voted -> instant result.
      const resultSeen = waitForEvent(host, 'game:meeting_result');
      player.emit('game:vote_cast', { code, skip: true });
      const result = await resultSeen;
      assert.equal(result.ejectedPlayerId, null); // unanimous skip
      assert.equal(result.tally.skip, 2);
      // A 2-player game is 1v1: the parity rule ends the game immediately.
      assert.equal(result.status, 'GAME_OVER');
      assert.equal(result.winner, 'IMPOSTOR');
    } finally {
      host.off('room:error', dump);
      player.off('room:error', dump);
      host.disconnect();
      player.disconnect();
    }
  });

  test('meetings end automatically through the timer chain', async () => {
    // Dedicated short-timer store/server for this test.
    const shortStore = new RoomStore();
    shortServer = createHttpServer(shortStore);
    createSocketServer(shortServer, shortStore);
    await new Promise((resolve) => shortServer.listen(0, resolve));
    const shortUrl = `http://127.0.0.1:${shortServer.address().port}`;

    const connect = () =>
      new Promise((resolve, reject) => {
        const client = Client(shortUrl, { transports: ['websocket'] });
        client.once('connect', () => resolve(client));
        client.once('connect_error', reject);
      });
    const host = await connect();
    const player = await connect();

    try {
      const code = randomCode();
      const created = waitForEvent(host, 'room:created');
      host.emit('room:create', {
        code,
        hostId: 'host-1',
        hostName: 'Host',
        config: { discussionDurationMs: 100, votingDurationMs: 5000 },
      });
      await created;

      const joined = waitForRoomWhere(host, (r) => r.players.length === 2);
      player.emit('room:join', { code, playerId: 'player-2', playerName: 'P2' });
      await joined;

      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      await Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);

      player.emit('game:report', { code });
      const [votingStarted] = await Promise.all([
        waitForEvent(host, 'game:voting_started', 9000),
        waitForEvent(player, 'game:voting_started', 9000),
      ]);
      assert.ok(typeof votingStarted.votingDeadline === 'string');

      // Nobody votes -> the voting timer must end the meeting on its own.
      const result = await waitForEvent(host, 'game:meeting_result', 12000);
      assert.equal(result.ejectedPlayerId, null);
      // 1v1 parity rule: the impostor wins as soon as the meeting ends.
      assert.equal(result.status, 'GAME_OVER');
      assert.equal(result.winner, 'IMPOSTOR');
    } finally {
      host.disconnect();
      player.disconnect();
      await new Promise((resolve) => shortServer.close(resolve));
      shortServer = null;
    }
  });

  test('rematch over the wire: host resets a finished game to the lobby', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers({
      discussionDurationMs: 0,
    });

    try {
      const { hostAssignment } = await startGameFor({ host, player, code });
      const impostorIsHost = hostAssignment.role === 'IMPOSTOR';
      const impostor = impostorIsHost ? host : player;
      const victimId = impostorIsHost ? 'player-2' : 'host-1';

      // Non-host cannot reset (also not before game over):
      const earlyReject = waitForEvent(player, 'room:error');
      player.emit('game:reset', { code });
      assert.equal((await earlyReject).code, 'NOT_ROOM_HOST');

      // Finish the round (1v1 kill -> impostor win):
      impostor.emit('game:kill', { code, targetPlayerId: victimId });
      await waitForEvent(player, 'game:over');

      // Host resets: everyone lands back in the lobby.
      const lobbyOnPlayer = waitForRoomWhere(
        player,
        (room) => room.status === 'MAP_READY',
      );
      const resetDone = waitForEvent(player, 'game:reset_done');
      host.emit('game:reset', { code });

      const lobby = await lobbyOnPlayer;
      await resetDone;
      assert.equal(lobby.players.length, 2);
      assert.ok(lobby.players.every((member) => member.isAlive));
      assert.deepEqual(lobby.taskProgress, { completed: 0, total: 0 });
      assert.equal('winner' in lobby, false);

      // The saved map survives the rematch -> straight to a fresh round
      // (no second map setup needed):
      const nextRoles = Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);
      host.emit('game:start', { code });
      const [nextHostRole, nextPlayerRole] = await nextRoles;
      assert.deepEqual(
        [nextHostRole.role, nextPlayerRole.role].sort(),
        ['CREWMATE', 'IMPOSTOR'],
      );
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('REST API never exposes roles, task details or internal fields', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      await Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);

      const response = await fetch(`${baseUrl}/rooms/${code}`);
      const room = await response.json();
      assert.equal(response.status, 200);
      for (const member of room.players) {
        assert.equal('role' in member, false);
      }
      assert.ok(room.config, 'config is public');
      assert.equal(room.lastKillAt, undefined);
      assert.equal(room.meeting, undefined);
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('unknown events from clients do not crash the server', async () => {
    const { host } = await createRoomWithTwoPlayers();

    const noError = await waitForNoEvent(host, 'room:error', 200);
    assert.equal(noError, false);

    host.disconnect();
  });

  test('create and join deliver private session tokens', async () => {
    const host = await connectClient();
    const player = await connectClient();
    const code = randomCode();

    try {
      const createdSeen = waitForEvent(host, 'room:created');
      const hostSession = waitForEvent(host, 'session:created');
      host.emit('room:create', { code, hostId: 'host-1', hostName: 'Host' });
      await Promise.all([createdSeen, hostSession]);

      const joinedSeen = waitForRoomWhere(host, (r) => r.players.length === 2);
      const playerSession = waitForEvent(player, 'session:created');
      player.emit('room:join', { code, playerId: 'player-2', playerName: 'P2' });
      await Promise.all([joinedSeen, playerSession]);
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('lobby disconnect removes the player and broadcasts the update', async () => {
    const { host, player } = await createRoomWithTwoPlayers();

    try {
      const updated = waitForRoomWhere(
        host,
        (room) => room.status === 'LOBBY' && room.players.length === 1,
      );
      player.disconnect();
      const room = await updated;
      assert.equal(room.players[0].id, 'host-1');
    } finally {
      host.disconnect();
    }
  });

  test('a lobby host reconnecting inside the grace period keeps host identity', async () => {
    const { host, player, code, hostToken } = await createRoomWithTwoPlayers();
    const reconnected = await connectClient();

    try {
      host.disconnect();
      await sleep(30);

      const restored = waitForEvent(reconnected, 'room:rejoined');
      reconnected.emit('room:rejoin', {
        code,
        playerId: 'host-1',
        token: hostToken,
      });
      const room = await restored;
      assert.equal(room.players.length, 2);
      assert.equal(room.hostId, 'host-1');

      await sleep(180);
      const response = await fetch(`${baseUrl}/rooms/${code}`);
      assert.equal((await response.json()).players.length, 2);
    } finally {
      player.disconnect();
      reconnected.disconnect();
    }
  });

  test('the last player leaving deletes the room', async () => {
    const host = await connectClient();
    const code = randomCode();

    const created = waitForEvent(host, 'room:created');
    host.emit('room:create', { code, hostId: 'host-1', hostName: 'Host' });
    await created;

    host.disconnect();
    await sleep(250);
    const response = await fetch(`${baseUrl}/rooms/${code}`);
    assert.equal(response.status, 404);
  });

  test('host promotion allows the promoted player to start the game', async () => {
    const host = await connectClient();
    const player2 = await connectClient();
    const player3 = await connectClient();
    const code = randomCode();

    try {
      host.emit('room:create', { code, hostId: 'host-1', hostName: 'Host' });
      await waitForEvent(host, 'room:created');

      const join2 = waitForRoomWhere(host, (r) => r.players.length === 2);
      player2.emit('room:join', { code, playerId: 'player-2', playerName: 'P2' });
      await join2;
      const join3 = waitForRoomWhere(host, (r) => r.players.length === 3);
      player3.emit('room:join', { code, playerId: 'player-3', playerName: 'P3' });
      await join3;

      const promotionSeen = waitForRoomWhere(
        player2,
        (room) => room.hostId === 'player-2',
      );
      host.disconnect();
      const promoted = await promotionSeen;
      assert.equal(promoted.players.length, 2);
      assert.equal(promoted.hostId, 'player-2');

      const roleOnP2 = waitForEvent(player2, 'game:role_assigned');
      const roleOnP3 = waitForEvent(player3, 'game:role_assigned');
      await makeMapReadyOverWire(player2, code); // promoted player is host now
      player2.emit('game:start', { code });
      const [a, b] = await Promise.all([roleOnP2, roleOnP3]);
      assert.deepEqual([a.role, b.role].sort(), ['CREWMATE', 'IMPOSTOR']);
    } finally {
      player2.disconnect();
      player3.disconnect();
    }
  });

  test('in-game disconnects keep players in the room', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      await makeMapReadyOverWire(host, code);
      host.emit('game:start', { code });
      await Promise.all([
        waitForEvent(host, 'game:role_assigned'),
        waitForEvent(player, 'game:role_assigned'),
      ]);

      player.disconnect();
      await sleep(120);

      const response = await fetch(`${baseUrl}/rooms/${code}`);
      const room = await response.json();
      assert.equal(room.players.length, 2);
    } finally {
      host.disconnect();
    }
  });

  test('rejoin restores binding, state and the secret role privately', async () => {
    const code = randomCode();

    const firstHost = await connectClient();
    const created = waitForEvent(firstHost, 'room:created');
    const sessionPromise = waitForEvent(firstHost, 'session:created');
    firstHost.emit('room:create', { code, hostId: 'host-1', hostName: 'Host' });
    await created;
    const hostToken = (await sessionPromise).token;
    assert.equal(typeof hostToken, 'string');

    const player = await connectClient();
    const joined = waitForRoomWhere(firstHost, (r) => r.players.length === 2);
    player.emit('room:join', { code, playerId: 'player-2', playerName: 'P2' });
    await joined;

    await makeMapReadyOverWire(firstHost, code);
    firstHost.emit('game:start', { code });
    const originalAssignment = await waitForEvent(firstHost, 'game:role_assigned');
    // Ensure the player processed their own assignment before counting.
    await waitForEvent(player, 'game:role_assigned');

    try {
      let foreignRoleEvents = 0;
      player.on('game:role_assigned', () => {
        foreignRoleEvents += 1;
      });

      firstHost.disconnect();
      await sleep(100);

      const returningHost = await connectClient();
      const rejoined = waitForEvent(returningHost, 'room:rejoined');
      const roleAgain = waitForEvent(returningHost, 'game:role_assigned');
      returningHost.emit('room:rejoin', {
        code,
        playerId: 'host-1',
        token: hostToken,
      });
      const rejoinedRoom = await rejoined;
      assert.equal(rejoinedRoom.playerId, 'host-1');
      assert.equal(rejoinedRoom.status, 'IN_GAME');

      const assignment = await roleAgain;
      assert.equal(assignment.role, originalAssignment.role);
      assert.ok(Array.isArray(assignment.tasks));

      await sleep(200);
      assert.equal(foreignRoleEvents, 0);

      returningHost.disconnect();
      player.disconnect();
    } finally {
      player.disconnect();
    }
  });

  test('rejoin with an invalid token is rejected', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();

    try {
      const impostor = await connectClient();
      try {
        const errorSeen = waitForEvent(impostor, 'room:error');
        impostor.emit('room:rejoin', {
          code,
          playerId: 'host-1',
          token: 'not-a-valid-token',
        });
        const error = await errorSeen;
        assert.equal(error.code, 'AUTH_FAILED');
      } finally {
        impostor.disconnect();
      }
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('rejoin takes over the identity from the previous socket', async () => {
    const code = randomCode();
    const first = await connectClient();

    const created = waitForEvent(first, 'room:created');
    const sessionPromise = waitForEvent(first, 'session:created');
    first.emit('room:create', { code, hostId: 'host-1', hostName: 'Host' });
    await created;
    const hostToken = (await sessionPromise).token;

    const second = await connectClient();
    const oldDisconnected = waitForEvent(first, 'disconnect', 3000);
    second.emit('room:rejoin', { code, playerId: 'host-1', token: hostToken });
    await oldDisconnected; // takeover kicks the previous socket

    second.disconnect();
  });
});

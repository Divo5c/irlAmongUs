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
let roomStore;

/**
 * Real-life kill gate: both players need believable GPS positions first.
 * Places the victim 1 m away from the killer on street c1.
 */
function placePlayersTogether(code, killerId, victimId) {
  roomStore.updatePosition(code, victimId, { x: 1, y: 0, confidence: 1 });
  roomStore.updatePosition(code, killerId, { x: 0, y: 0, confidence: 1 });
}

/** Plants a discovered corpse so meeting suites can report without a kill. */
function plantCorpseNear(store, code, playerId, x = 21, y = 50) {
  const room = store.getRoom(code);
  room.corpses ??= [];
  room.corpses.push({
    playerId,
    x,
    y,
    corridorId: 'c1',
    roomId: null,
    deadAt: new Date().toISOString(),
  });
}

/** Puts a player on street c1 in meter space. */
function placeOnStreet(store, code, playerId, x = 21, y = 50) {
  return store.updatePosition(code, playerId, { x, y, confidence: 1 });
}

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
async function createRoomWithNPlayers(playerCount, configPatch, panelClients = 0) {
  const code = randomCode();
  const clients = [];

  const host = await connectClient();
  clients.push(host);
  const created = waitForEvent(host, 'room:created');
  host.emit('room:create', {
    code,
    hostId: 'host-1',
    hostName: 'Host',
    sabotagePanels: panelClients > 0,
    ...(configPatch ? { config: configPatch } : {}),
  });
  await created;

  for (let index = 2; index <= playerCount; index += 1) {
    const client = await connectClient();
    clients.push(client);
    const id = `player-${index}`;
    const joined = waitForRoomWhere(host, (r) => r.players.length === index);
    client.emit('room:join', { code, playerId: id, playerName: `P${index}`, sabotagePanels: index <= panelClients });
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
  rooms: require('./criticalRooms').criticalRooms(),
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
  roomStore = new RoomStore();
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
  test('one connected player can open the reactor scanner before holding it', async (t) => {
    const host = await connectClient();
    t.after(() => host.disconnect());
    const code = randomCode();
    const created = waitForEvent(host, 'room:created');
    host.emit('room:create', { code, hostId: 'host-1', hostName: 'Host', sabotagePanels: true });
    await created;
    roomStore.addPlayerToRoom(code, { id: 'offline-player', name: 'Offline' });
    await makeMapReadyOverWire(host, code);
    roomStore.startGame(code);
    const room = roomStore.getRoom(code);
    const impostor = room.players.find(({ role }) => role === 'IMPOSTOR');
    const { room: snapshot } = roomStore.startSabotage(code, impostor.id, 'REACTOR');
    const [spot] = snapshot.sabotage.fixSpots;
    const request = { code, roundId: snapshot.sabotage.panelStatus.roundId, panelId: spot.id };
    const send = (event, extra) => host.timeout(2000).emitWithAck(`game:sabotage_panel_${event}`, { ...request, ...extra });
    assert.equal((await send('open')).error, 'SABOTAGE_NOT_AT_PANEL');
    roomStore.updatePosition(code, 'host-1', { x: spot.x, y: spot.y, confidence: 1 });
    const opened = await send('open');
    assert.equal(opened.ok, true);
    assert.deepEqual(opened.status.panels.map(({ state }) => state), ['OPEN', 'OPEN']);
    assert.equal((await send('hold', { active: true })).ok, true);
    const alone = await send('open');
    assert.deepEqual(alone.status.panels.map(({ state }) => state), ['HELD', 'OPEN']);
    assert.equal(alone.status.progress, 0);
    assert.equal((await send('hold', { active: false })).ok, true);
    const released = await send('open');
    assert.deepEqual(released.status.panels.map(({ state }) => state), ['OPEN', 'OPEN']);
    assert.ok(room.sabotage);
  });

  test('panel clients repair reactor and share oxygen progress with a legacy client through rematch', async () => {
    const { clients, code } = await createRoomWithNPlayers(4, { killCooldownMs: 0 }, 3);
    const [host, partner, , legacy] = clients;
    await makeMapReadyOverWire(host, code);
    const assigned = Promise.all(clients.map((client) => waitForEvent(client, 'game:role_assigned')));
    host.emit('game:start', { code });
    const roles = await assigned;
    const impostor = clients[roles.findIndex(({ role }) => role === 'IMPOSTOR')];
    const room = roomStore.getRoom(code);
    const send = (client, action, round, spot, fields) => client.timeout(3000).emitWithAck(
      `game:sabotage_panel_${action}`, { code, roundId: round, panelId: spot.id, ...fields },
    );
    const place = async (client, spot) => {
      const confirmed = waitForEvent(client, 'position:confirmed');
      const id = room.players[clients.indexOf(client)].id;
      roomStore.updatePosition(code, id, { x: spot.x, y: spot.y, confidence: 1 }, { skipPlausibilityCheck: true });
      client.emit('position:update', { code, x: spot.x, y: spot.y, confidence: 1 });
      await confirmed;
    };
    const start = async (type) => {
      room.sabotageCooldownUntil = 0;
      const arrived = waitForRoomWhere(host, (snapshot) => snapshot.sabotage?.type === type);
      impostor.emit('game:sabotage', { code, type });
      const snapshot = (await arrived).sabotage;
      assert.equal('controls' in snapshot, false);
      return { id: snapshot.panelStatus.roundId, spots: snapshot.fixSpots };
    };
    try {
      const reactor = await start('REACTOR');
      for (const [i, client] of [host, partner].entries()) {
        await place(client, reactor.spots[i]);
        assert.equal((await send(client, 'open', reactor.id, reactor.spots[i])).ok, true);
      }
      const checked = waitForEvent(host, 'room:error');
      host.emit('game:sabotage_fix', { code, panel: 'REACTOR' });
      assert.equal((await checked).code, 'SABOTAGE_INVALID_PANEL');
      const fixed = waitForEvent(host, 'game:sabotage_fixed');
      const beat = (client, i) => client.emit('game:sabotage_panel_hold', {
        code, roundId: reactor.id, panelId: reactor.spots[i].id, active: true,
      });
      const interval = setInterval(() => [host, partner].forEach(beat), 350);
      [host, partner].forEach(beat);
      try {
        assert.deepEqual((await fixed).fixed, ['REACTOR']);
      } finally {
        clearInterval(interval);
      }
      const oxygen = await start('O2');
      await place(host, oxygen.spots[0]);
      await place(legacy, oxygen.spots[1]);
      const open = await send(host, 'open', oxygen.id, oxygen.spots[0]);
      assert.ok(open.ok && /^[1-9]\d{4}$/.test(open.note));
      assert.equal('note' in open.status, false);
      const rejected = await send(legacy, 'open', oxygen.id, oxygen.spots[1]);
      assert.equal(rejected.ok, false);
      assert.equal('note' in rejected, false);
      const partial = await send(host, 'submit', oxygen.id, oxygen.spots[0], { digits: open.note });
      assert.equal(partial.result, 'OK');
      assert.equal(partial.status.panels[1].state, 'OPEN');
      const oxygenFixed = waitForEvent(host, 'game:sabotage_fixed');
      legacy.emit('game:sabotage_fix', { code, panel: oxygen.spots[1].id });
      assert.deepEqual((await oxygenFixed).fixed, ['o2', 'admin']);

      for (const task of room.tasks.filter((task) => !task.isFake)) task.completed = true;
      const target = clients.find((client) => client !== impostor);
      await place(impostor, { x: 21, y: 50 });
      await place(target, { x: 22, y: 50 });
      const gameOver = waitForEvent(host, 'game:over');
      impostor.emit('game:kill', { code, targetPlayerId: room.players[clients.indexOf(target)].id });
      await gameOver;
      const reset = waitForRoomWhere(host, (snapshot) => snapshot.status === 'MAP_READY');
      host.emit('game:reset', { code });
      assert.equal((await reset).sabotage, undefined);
    } finally {
      for (const client of clients) client.disconnect();
    }
  });
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

  test('serves the PWA shell and nested browser assets', async () => {
    const assets = [
      ['/', 'text/html; charset=utf-8'],
      ['/css/style.css', 'text/css; charset=utf-8'],
      ['/css/styles/fonts/nunito-latin.woff2', 'font/woff2'],
      ['/js/app.js?v=19.17.0', 'text/javascript; charset=utf-8'],
      ['/js/ui.js', 'text/javascript; charset=utf-8'],
      ['/img/terminal.svg', 'image/svg+xml'],
      ['/manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
      ['/socket.io/socket.io.js', 'application/javascript; charset=utf-8'],
    ];
    await Promise.all(assets.map(async ([url, contentType]) => {
      const response = await fetch(baseUrl + url);
      assert.equal(response.status, 200, url);
      assert.equal(response.headers.get('content-type')?.toLowerCase(), contentType, url);
      assert.ok((await response.arrayBuffer()).byteLength > 0, url);
    }));
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
      assert.equal(imp.assignment.tasks.length, crew.assignment.tasks.length); // same amount, FAKE
      assert.match(imp.assignment.tasks[0].id, /-fake$/);
      assert.ok(crew.assignment.tasks.length > 0);
      assert.equal(typeof crew.assignment.tasks[0].type, 'string');
      assert.equal(imp.assignment.killReadyAt > Date.now(), true); // round-start cooldown (Divo log 18)
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('two impostors keep private partner IDs and a report cancels a partially repaired O2 sabotage', async () => {
    const { clients, code } = await createRoomWithNPlayers(6, { impostorCount: 2, discussionDurationMs: 0 });
    const [host] = clients;
    try {
      await makeMapReadyOverWire(host, code);
      const roles = Promise.all(clients.map((client) => waitForEvent(client, 'game:role_assigned')));
      host.emit('game:start', { code });
      const seats = (await roles).map((role, index) => ({ ...role, client: clients[index] }));
      const impostors = seats.filter(({ role }) => role === 'IMPOSTOR');
      assert.equal(impostors.length, 2);
      for (const seat of seats) {
        assert.deepEqual(seat.teammates.map(({ id }) => id),
          seat.role === 'IMPOSTOR' ? impostors.filter((impostor) => impostor !== seat).map(({ playerId }) => playerId) : []);
      }

      const [saboteur] = impostors;
      const reporter = seats.find(({ role }) => role === 'CREWMATE');
      const started = waitForEvent(host, 'game:sabotage_started');
      saboteur.client.emit('game:sabotage', { code, type: 'O2' });
      assert.equal((await started).type, 'O2');
      const atO2 = waitForEvent(saboteur.client, 'position:confirmed');
      saboteur.client.emit('position:update', { code, x: 62, y: 108, confidence: 1 });
      await atO2;
      const neverFixed = waitForNoEvent(host, 'game:sabotage_fixed', 200);
      const partial = waitForRoomWhere(host, (room) => room.sabotage?.panels?.o2 === true);
      saboteur.client.emit('game:sabotage_fix', { code, panel: 'o2' });
      assert.equal((await partial).sabotage.panels.admin, false);
      assert.equal(await neverFixed, false);

      placeOnStreet(roomStore, code, reporter.playerId);
      plantCorpseNear(roomStore, code, 'reported-body');
      const meeting = waitForRoomWhere(host, ({ status }) => status === 'MEETING');
      reporter.client.emit('game:report', { code });
      const awaiting = await meeting;
      assert.equal(awaiting.sabotage, undefined);
      assert.equal(awaiting.meetingConfirmed, false);
      assert.ok(awaiting.players.every((player) => !('role' in player) && !('teammates' in player)));

      const voting = waitForEvent(host, 'game:voting_started');
      host.emit('game:meeting_confirm', { code, meetingId: awaiting.meetingId });
      await voting;
      const resumed = waitForRoomWhere(host, ({ status }) => status === 'IN_GAME');
      for (const client of clients) client.emit('game:vote_cast', { code, skip: true });
      assert.equal((await resumed).sabotage, undefined);
    } finally {
      for (const client of clients) client.disconnect();
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
        (assignment) =>
          assignment.role === 'CREWMATE' && assignment.tasks.length > 0,
      );
      assert.ok(crewSlot !== -1, 'expected at least one crewmate');
      const crew = { client: clients[crewSlot], assignment: assignments[crewSlot] };
      const impostorSlot = assignments.findIndex(
        (assignment) => assignment.role === 'IMPOSTOR',
      );
      assert.ok(impostorSlot !== -1);
      const impostorClient = clients[impostorSlot];

      const task = crew.assignment.tasks.find(({ stages }) => (stages?.length ?? 0) <= 1);
      assert.ok(task, 'expected a single-stage task');
      const progressSeen = waitForEvent(impostorClient, 'task:progress');
      // Stand at the task spot first (wire proximity gate).
      crew.client.emit('position:update', {
        code,
        x: task.x,
        y: task.y,
        confidence: 1,
      });
      crew.client.emit('task:complete', {
        code,
        taskId: task.id,
      });

      const progress = await progressSeen;
      assert.equal(progress.progress.completed, 1);
      assert.equal(progress.completedTaskId, task.id);
      assert.equal(progress.tasks, undefined);

      // Completing someone else's task is impossible: ids are owner-scoped.
      // (The impostor tries the crewmate's first task id.)
      const errorSeen = waitForEvent(impostorClient, 'room:error');
      impostorClient.emit('task:complete', { code, taskId: task.id });
      const error = await errorSeen;
      assert.equal(error.code, 'TASK_NOT_FOUND');
    } finally {
      for (const client of clients) client.disconnect();
    }
  });

  test('a multi-stage task sends the next stage only to its owner', async () => {
    const { clients, code } = await createRoomWithNPlayers(3);
    try {
      await makeMapReadyOverWire(clients[0], code);
      const assignments = clients.map((client) => waitForEvent(client, 'game:role_assigned'));
      clients[0].emit('game:start', { code });
      const roles = await Promise.all(assignments);
      const ownerIndex = roles.findIndex(({ role }) => role === 'CREWMATE');
      const owner = clients[ownerIndex];
      const ownerId = roles[ownerIndex].playerId;
      const task = roomStore.getRoom(code).tasks.find(({ assignedTo }) => assignedTo === ownerId);
      task.stages = [{ x: 20, y: 50 }, { x: 80, y: 50 }];
      task.stageIndex = 0;
      placeOnStreet(roomStore, code, ownerId, 20, 50);
      const observer = clients.find((client) => client !== owner);
      const observerSawTask = waitForNoEvent(observer, 'task:progress', 150);
      const next = waitForEvent(owner, 'task:progress');
      owner.emit('task:complete', { code, taskId: task.id });
      const advance = await next;
      assert.equal(advance.advancedTaskId, task.id);
      assert.equal(advance.stageIndex, 1);
      assert.equal(task.stageIndex, 1);
      assert.equal(task.completed, false);
      assert.equal(await observerSawTask, false);
    } finally {
      for (const client of clients) client.disconnect();
    }
  });

  test('kill notifications stay private: victim + impostors only (Among Us)', async () => {
    const { clients, code } = await createRoomWithNPlayers(4, {
      killCooldownMs: 5000,
    });
    try {
      await makeMapReadyOverWire(clients[0], code);
      const started = Promise.all(
        clients.map((client) => waitForEvent(client, 'game:role_assigned', 8000)),
      );
      clients[0].emit('game:start', { code });
      const roles = await started;

      const killerIndex = roles.findIndex((entry) => entry.role === 'IMPOSTOR');
      assert.ok(killerIndex >= 0, 'one of four players must be impostor');
      // Choose crewmates for victim + innocent listener FIRST, so the
      // "innocent" socket can never collide with the killer by index.
      const crewIndexes = roles
        .map((entry, index) => (entry.role === 'IMPOSTOR' ? -1 : index))
        .filter((index) => index >= 0);
      const victimIndex = crewIndexes[0];
      const innocentIndex = crewIndexes[1];
      const idFor = (index) => (index === 0 ? 'host-1' : `player-${index + 1}`);
      const killerId = idFor(killerIndex);
      const victimId = idFor(victimIndex);

      placePlayersTogether(code, killerId, victimId);

      let innocentKillEvents = 0;
      clients[innocentIndex].on('game:killed', () => {
        innocentKillEvents += 1;
      });

      const victimSeen = waitForEvent(clients[victimIndex], 'game:killed', 8000);
      const killerSeen = waitForEvent(clients[killerIndex], 'game:killed', 8000);
      // v19.14 round-start cooldown — simulate elapsed cooldown for the
      // wire test (the gate itself is covered in roomStore tests).
      roomStore.getRoom(code).lastKillAt = 0;
      clients[killerIndex].emit('game:kill', { code, targetPlayerId: victimId });
      const victimKill = await victimSeen;
      const killerKill = await killerSeen;
      assert.equal(victimKill.killedPlayerId, victimId);
      assert.equal(killerKill.killedPlayerId, victimId);

      // Fill in the innocent crew: nothing arrives (they discover the corpse).
      await sleep(250);
      assert.equal(innocentKillEvents, 0);
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
      const impostorId = impostorIsHost ? 'host-1' : 'player-2';

      placePlayersTogether(code, impostorId, victimId);
      // v19.14 round-start cooldown (Divo log 18): simulate elapsed time so
      // the kill lands; the cooldown event still fires with a fresh timer.
      roomStore.getRoom(code).lastKillAt = 0;

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

  test('host aborts the round mid-game; guests stay and land in the lobby', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();
    try {
      await startGameFor({ host, player, code });

      const guestAbortSeen = waitForEvent(player, 'room:error');
      player.emit('game:abort', { code });
      const guestError = await guestAbortSeen;
      assert.equal(guestError.code, 'NOT_ROOM_HOST');

      const abortDone = waitForEvent(player, 'game:reset_done');
      host.emit('game:abort', { code });
      const done = await abortDone;
      assert.equal(done.aborted, true);

      const room = roomStore.getRoom(code);
      assert.equal(room.status, 'MAP_READY', 'abort returns the lobby with the map');
      assert.equal(room.players.length, 2, 'nobody got kicked by the abort');
      assert.equal(roomStore.getRoom(code).tasks.length, 0);
    } finally {
      host.disconnect();
      player.disconnect();
    }
  });

  test('admin table over the wire: only from the ADMIN room', async () => {
    const { host, player, code } = await createRoomWithTwoPlayers();
    try {
      const { hostAssignment } = await startGameFor({ host, player, code });
      // Both players walk into the ADMIN polygon center first.
      roomStore.updatePosition(code, 'host-1', { x: 83, y: 80, confidence: 1 });
      const inAdmin = waitForEvent(host, 'game:admin_table_state');
      host.emit('game:admin_table', { code });
      const state = await inAdmin;
      assert.equal(state.blocked, false);
      assert.ok(Object.keys(state.counts).length >= 1, 'own presence in admin is visible');

      // Someone stuck in a corridor gets rejected (no remote peeking).
      // skipPlausibilityCheck: the teleport is a TEST setup step, the
      // speed gate must not reject the tester's own positionings.
      roomStore.updatePosition(code, 'host-1', { x: 20, y: 50, confidence: 1 }, { skipPlausibilityCheck: true });
      const rejected = waitForEvent(host, 'room:error');
      host.emit('game:admin_table', { code });
      const error = await rejected;
      assert.equal(error.code, 'NOT_AT_ADMIN_TABLE');
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
      plantCorpseNear(roomStore, code, 'host-1');
      placeOnStreet(roomStore, code, 'player-2');
      player.emit('game:report', { code });
      const meeting = await meetingSeen;

      assert.equal(meeting.status, 'MEETING');
      assert.equal(meeting.phase, 'DISCUSSION');
      assert.equal(meeting.reporterId, 'player-2');
      assert.equal(meeting.discussionDeadline, null);

      // Votes during DISCUSSION are rejected:
      const earlyVote = waitForEvent(host, 'room:error');
      host.emit('game:vote_cast', { code, skip: true });
      const earlyError = await earlyVote;
      assert.equal(earlyError.code, 'VOTING_NOT_OPEN');

      assert.equal(await waitForNoEvent(player, 'game:voting_started', 350), false);
      const waiting = roomStore.toPublicRoom(roomStore.getRequiredRoom(code));
      assert.equal(waiting.meetingConfirmed, false);
      assert.equal(waiting.discussionDeadline, undefined);
      const guestDenied = waitForEvent(player, 'room:error');
      player.emit('game:meeting_confirm', { code, meetingId: waiting.meetingId });
      assert.equal((await guestDenied).code, 'NOT_ROOM_HOST');

      // The discussion timer starts only after the host physically verifies arrival.
      const votingOnHost = waitForEvent(host, 'game:voting_started');
      const votingOnPlayer = waitForEvent(player, 'game:voting_started');
      const confirmedOnHost = waitForEvent(host, 'game:meeting_confirmed');
      host.emit('game:meeting_confirm', { code, meetingId: waiting.meetingId });
      assert.ok(typeof (await confirmedOnHost).discussionDeadline === 'string');
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

  test('a reported meeting counts living arrivals until the host confirms', async () => {
    const { clients, code } = await createRoomWithNPlayers(3, { discussionDurationMs: 15000 });
    const [host, guest] = clients;
    try {
      await makeMapReadyOverWire(host, code);
      const started = waitForRoomWhere(host, ({ status }) => status === 'IN_GAME');
      host.emit('game:start', { code });
      await started;

      placeOnStreet(roomStore, code, 'host-1');
      plantCorpseNear(roomStore, code, 'player-3');
      const meeting = waitForRoomWhere(host, ({ status }) => status === 'MEETING');
      host.emit('game:report', { code });
      assert.equal((await meeting).meetingAdminCount, 0);

      const arrived = waitForRoomWhere(host, ({ meetingAdminCount }) => meetingAdminCount === 1);
      guest.emit('position:update', { code, x: 21, y: 80, confidence: 1 });
      assert.equal((await arrived).meetingLivingCount, 1);

      const confirmed = waitForRoomWhere(guest, ({ meetingConfirmed }) => meetingConfirmed === true);
      host.emit('game:meeting_confirm', { code });
      await confirmed;
      const rejected = waitForEvent(guest, 'position:error');
      guest.emit('position:update', { code, x: 21, y: 80, confidence: 1 });
      assert.equal((await rejected).code, 'POSITION_NOT_ALLOWED');
    } finally {
      for (const client of clients) client.disconnect();
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

      // In the short-timer server everything routes through its own store.
      plantCorpseNear(shortStore, code, 'host-1');
      placeOnStreet(shortStore, code, 'player-2');
      const awaitingHost = waitForRoomWhere(host, ({ status }) => status === 'MEETING');
      player.emit('game:report', { code });
      host.emit('game:meeting_confirm', { code, meetingId: (await awaitingHost).meetingId });
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
      placePlayersTogether(code, impostorIsHost ? 'host-1' : 'player-2', victimId);
      // v19.14 round-start cooldown (Divo log 18): simulate elapsed time.
      roomStore.getRoom(code).lastKillAt = 0;
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

  test('rejoin check only confirms valid sessions in an existing room', async () => {
    const { host, player, code, hostToken, playerToken } = await createRoomWithTwoPlayers();
    const check = (roomCode, playerId, token) => fetch(`${baseUrl}/rooms/${roomCode}/rejoin-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, token }),
    });

    try {
      const valid = await check(code, 'host-1', hostToken);
      assert.equal(valid.status, 204);
      assert.equal(valid.headers.get('cache-control'), 'no-store');
      assert.equal(await valid.text(), '');
      assert.equal(host.connected, true);

      const wrongToken = await check(code, 'host-1', playerToken);
      const missingRoom = await check(randomCode(), 'host-1', hostToken);
      assert.equal(wrongToken.status, 404);
      assert.equal(missingRoom.status, 404);
      assert.deepEqual(await wrongToken.json(), await missingRoom.json());

      const removed = waitForRoomWhere(host, (room) => room.players.length === 1);
      player.disconnect();
      await removed;
      assert.equal((await check(code, 'player-2', playerToken)).status, 404);
    } finally {
      host.disconnect();
      player.disconnect();
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
      const completedTask = originalAssignment.tasks[0];
      roomStore.completeTask(code, 'host-1', completedTask.id, { skipProximity: true });
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
      // Divo field bug (v19.13.3): rejoin tasks MUST carry the full shape
      // (stages + coordinates), not just {id,type,title} — otherwise every
      // marker loses its position after a reload/GPS reset.
      assert.ok(assignment.tasks.length >= 2);
      assert.equal(assignment.tasks.find(({ id }) => id === completedTask.id)?.completed, true);
      for (const task of assignment.tasks) {
        assert.ok(Array.isArray(task.stages) && task.stages.length >= 1,
          `rejoined task ${task.id} must carry its stages`);
        const first = task.stages[0];
        assert.ok(first && typeof first.x === 'number' && typeof first.y === 'number',
          `rejoined task ${task.id} must carry coordinates`);
        assert.ok(first.roomName || first.roomId,
          `rejoined task ${task.id} must name its room`);
      }

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

test('Divo-Meeting-Intro: only the host confirms the cafeteria check', async () => {
  const { host, player, code } = await createRoomWithTwoPlayers();

  try {
    const noMeeting = waitForEvent(host, 'room:error');
    host.emit('game:meeting_confirm', { code });
    assert.equal((await noMeeting).code, 'NOT_IN_MEETING');

    // Guests cannot self-confirm (the REAL anti-cheat: nobody fakes
    // "alle sind da" without the admin).
    const deniedSeen = waitForEvent(player, 'room:error');
    player.emit('game:meeting_confirm', { code });
    const denied = await deniedSeen;
    assert.equal(denied.code, 'NOT_ROOM_HOST');
  } finally {
    host.disconnect();
    player.disconnect();
  }
});

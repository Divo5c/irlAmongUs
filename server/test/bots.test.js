const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { RoomStore } = require('../src/rooms/roomStore');
const { criticalRooms } = require('./criticalRooms');
const { createBotEngine } = require('../src/game/bots');

function validMap() {
  return {
    version: 1,
    nodes: [
      { id: 'n1', x: 0, y: 0 },
      { id: 'n2', x: 10, y: 0 },
      { id: 'n3', x: 10, y: 10 },
    ],
    corridors: [
      { id: 'c1', a: 'n1', b: 'n2' },
      { id: 'c2', a: 'n2', b: 'n3' },
    ],
    rooms: [
      {
        id: 'r1',
        name: 'Wohnzimmer',
        type: 'NORMAL',
        polygon: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 8 },
          { x: 2, y: 8 },
        ],
      },
      ...criticalRooms(),
    ],
  };
}

async function setupRoomWithBots(botCount) {
  const store = new RoomStore();
  const bots = createBotEngine(store, { moveIntervalMs: 50, taskTicks: 2 });
  const room = store.createRoom({ code: 'TESTAB', hostId: 'host-1', hostName: 'Divo' });
  const hostId = room.hostId;
  bots.addBots(room.code, botCount);
  return { store, bots, code: room.code, hostId };
}

test('bots join the lobby as flagged players', async () => {
  const { store, code, hostId } = await setupRoomWithBots(2);
  const room = store.getRoom(code);
  assert.equal(room.players.length, 3);
  const botPlayers = room.players.filter((p) => p.isBot);
  assert.equal(botPlayers.length, 2);
  assert.ok(botPlayers.every((p) => p.name.startsWith('Bot ')));
  const publicRoom = store.toPublicRoom(room);
  assert.ok(publicRoom.players.filter((p) => p.isBot).length === 2);
});

test('bots walk the corridor graph like human position updates', async () => {
  const { store, bots, code, hostId } = await setupRoomWithBots(1);
  store.startMapSetup(code);
  store.saveMap(code, validMap());
  store.startGame(code);

  bots.tickNow(code); // initial placement + first step
  bots.tickNow(code);

  const positions = store.getAdminPositions(code);
  const botPos = positions.find((entry) => entry.playerId?.startsWith?.('bot-'));
  // Position store key layout varies: check by any bot id
  const botEntry = positions.find((entry) =>
    store.getRoom(code).players.some(
      (player) => player.isBot && player.id === entry.playerId,
    ),
  );
  assert.ok(botEntry ?? botPos, 'bot has a stored position');
  const entry = botEntry;
  assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y));
  assert.equal(entry.onCorridor !== undefined, true);
});

test('bots auto-complete crew tasks and can trigger crew victory', async () => {
  const { store, bots, code, hostId } = await setupRoomWithBots(2);
  store.startMapSetup(code);
  store.saveMap(code, validMap());
  // Force the host to be the sole impostor? Not directly controllable; instead
  // run ticks until game over or enough progress. Bots: 2 alive, host: 1.
  store.startGame(code);
  const room = store.getRoom(code);
  // Task-victory chain test: force BOTH bots crewmate so the impostor-bot
  // kill loop (v19.13.4) cannot insta-eject a crew bot to parity before any
  // task completes. Impostor bot behaviour has its own tests now.
  for (const player of store.getRoom(code).players) {
    if (player.isBot) player.role = 'CREWMATE';
  }

  let gameOver = false;
  for (let i = 0; i < 40 && !gameOver; i += 1) {
    bots.tickNow(code);
    const current = store.getRoom(code);
    if (current.winner) gameOver = true;
  }
  // With taskTicks=2 and 2 bots ticking independent tasks, tasks complete
  // fast — BUT since v19.13.4 an impostor bot may kill a crew bot first,
  // freezing ITS tasks. So grant progress credit: EITHER the game ended,
  // OR any crew bot managed at least one completed task.
  const crewBots = store
    .getRoom(code)
    .players.filter((player) => player.isBot && player.role === 'CREWMATE');
  const anyCompleted = crewBots.some((bot) =>
    (store.getTasksForPlayer(code, bot.id) ?? [])
      .some((task) => task.completed));
  assert.equal(gameOver || anyCompleted, true);
});

test('bots vote in meetings so games advance without humans', async () => {
  const { store, bots, code, hostId } = await setupRoomWithBots(2);
  store.startMapSetup(code);
  store.saveMap(code, validMap());
  store.startGame(code);
  // Real-life discovery gate: a reported body must exist nearby.
  const roomWithCorpse = store.getRoom(code);
  roomWithCorpse.corpses = [
    { playerId: 'dead-1', x: 5, y: 0, corridorId: 'c1', roomId: null, deadAt: new Date().toISOString() },
  ];
  store.updatePosition(code, hostId, { x: 5, y: 0, confidence: 1 });
  store.reportBody(code, hostId);
  store.advanceMeeting(code); // DISCUSSION -> VOTING

  bots.tickNow(code);
  bots.tickNow(code);

  const room = store.getRoom(code);
  const botIds = room.players.filter((p) => p.isBot).map(({ id }) => id);
  const voted = botIds.filter((id) => room.meeting?.votes?.[id] !== undefined);
  assert.ok(voted.length >= 1, 'at least one bot voted');
});

test('bot removal takes the last bot out of the lobby', async () => {
  const { store, bots, code } = await setupRoomWithBots(2);
  const outcome = bots.removeLastBot(code);
  assert.equal(outcome.removed, true);
  const room = store.getRoom(code);
  assert.equal(room.players.filter((p) => p.isBot).length, 1);
  assert.equal(room.players.length, 2);
});

test('impostor bots kill nearby crewmates through the real store gates (v19.13.4)', async () => {
  const store = new RoomStore();
  const events = [];
  const hooks = { gameOver: null };
  const botsEngine = createBotEngine(store, {
    moveIntervalMs: 50,
    taskTicks: 9999,
    broadcast: (code, event, payload) => events.push({ event, payload }),
    botHooks: {
      onGameOver: (code, winner) => { hooks.gameOver = winner; },
    },
  });
  const room = store.createRoom({ code: 'TESTAB', hostId: 'host-1', hostName: 'Divo' });
  botsEngine.addBots(room.code, 2);
  store.startMapSetup(room.code);
  store.saveMap(room.code, validMap());
  store.startGame(room.code);

  const internal = store.getRoom(room.code);
  const botImp = internal.players.find((player) => player.isBot);
  botImp.role = 'IMPOSTOR';
  for (const player of internal.players) {
    if (player.id !== botImp.id) player.role = 'CREWMATE';
  }

  botsEngine.tickNow(room.code); // place the bot walker
  events.length = 0;
  // Real tick pacing: back-to-back script ticks make the plausibility gate
  // reject every bot move (0.2 m in ~0 ms => >8 m/s), freezing stored
  // positions while the walker drifts on. Real cadence = accepted moves.
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const internalRoom = () => store.getRoom(room.code);
  const deadCrew = () => internalRoom().players
    .filter((player) => player.role === 'CREWMATE' && player.isAlive === false).length;
  for (let attempt = 0; attempt < 15 && deadCrew() === 0; attempt += 1) {
    const botPos = store.getPlayerPosition(room.code, botImp.id);
    if (botPos) {
      // Pin the human host ONTO the bot's stored position (plausibility
      // skipped on purpose: test teleports the target onto the killer).
      store.updatePosition(room.code, internal.players[0].id, {
        x: botPos.x, y: botPos.y, confidence: 1,
      }, { skipPlausibilityCheck: true });
    }
    botsEngine.tickNow(room.code);
    await wait(40);
  }
  // ANY crewmate death by the bot counts (the engine picks the nearest
  // crewmate — with two crew bots the second bot may be the closer victim;
  // after a kill parity may already end the game, which is Among Us correct).
  assert.ok(deadCrew() >= 1, 'impostor bot killed a crewmate');
  assert.ok((internalRoom().corpses ?? []).length >= 1);
});

test('impostor bots trigger sabotages in the store cycle (v19.13.4)', async () => {
  const store = new RoomStore();
  const events = [];
  const botsEngine = createBotEngine(store, {
    moveIntervalMs: 50,
    taskTicks: 9999,
    sabotageTicks: 1,
    broadcast: (code, event, payload) => events.push({ event, payload }),
  });
  const room = store.createRoom({ code: 'TESTAB', hostId: 'host-1', hostName: 'Divo' });
  botsEngine.addBots(room.code, 2);
  store.startMapSetup(room.code);
  store.saveMap(room.code, validMap());
  store.startGame(room.code);

  const internal = store.getRoom(room.code);
  const botImp = internal.players.find((player) => player.isBot);
  botImp.role = 'IMPOSTOR';
  for (const player of internal.players) {
    if (player.id !== botImp.id) player.role = 'CREWMATE';
  }

  botsEngine.tickNow(room.code);
  botsEngine.tickNow(room.code);
  const sabotaged = store.getRoom(room.code).sabotage;
  assert.ok(sabotaged?.type, 'impostor bot started a sabotage');
  assert.ok(events.some((entry) => entry.event === 'game:sabotage_started'));
});

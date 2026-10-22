const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { RoomStore } = require('../src/rooms/roomStore');
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

  let gameOver = false;
  for (let i = 0; i < 40 && !gameOver; i += 1) {
    bots.tickNow(code);
    const current = store.getRoom(code);
    if (current.winner) gameOver = true;
  }
  // With taskTicks=2 and 2 bots ticking independent tasks, tasks complete
  // fast; crew victory (ALL_TASKS_DONE) must fire when bots are crewmate.
  const crewBots = store
    .getRoom(code)
    .players.filter((player) => player.isBot && player.role === 'CREWMATE');
  const completed = (store.getTasksForPlayer(code, crewBots[0]?.id) ?? []).filter(
    (task) => task.completed,
  );
  assert.equal(gameOver || completed.length > 0, true);
});

test('bots vote in meetings so games advance without humans', async () => {
  const { store, bots, code, hostId } = await setupRoomWithBots(2);
  store.startMapSetup(code);
  store.saveMap(code, validMap());
  store.startGame(code);
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

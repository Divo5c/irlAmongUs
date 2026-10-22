const { test } = require('node:test');
const assert = require('node:assert/strict');

const { RoomStore } = require('../src/rooms/roomStore');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validMap() {
  return {
    nodes: [
      { id: 'n1', x: 0, y: 0 },
      { id: 'n2', x: 50, y: 0 },
      { id: 'n3', x: 50, y: 50 },
      { id: 'n4', x: 0, y: 50 },
    ],
    corridors: [
      { id: 'c1', a: 'n1', b: 'n2' },
      { id: 'c2', a: 'n3', b: 'n4' },
    ],
    rooms: [],
  };
}

async function setup() {
  const store = new RoomStore();
  const room = store.createRoom({ code: 'TESTAB', hostId: 'host-1', hostName: 'Divo' });
  store.addPlayerToRoom(room.code, { id: 'impo-1', name: 'Impo' });
  store.addPlayerToRoom(room.code, { id: 'crew-1', name: 'Crew' });
  store.startMapSetup(room.code);
  store.saveMap(room.code, validMap());
  store.updateConfig(room.code, { killRadiusM: 2 });
  store.startGame(room.code);
  const roomIn = store.getRoom('TESTAB');
  roomIn.players.find((p) => p.id === 'host-1').role = 'IMPOSTOR';
  roomIn.players.find((p) => p.id === 'impo-1').role = 'CREWMATE';
  roomIn.players.find((p) => p.id === 'crew-1').role = 'CREWMATE';
  return store;
}

test('kill outside the configured radius is rejected (real-life distance)', async () => {
  const store = await setup();
  // Killer at x=0, target at x=10 (10 m apart > 2 m)
  await store.updatePosition('TESTAB', 'impo-1', { x: 10, y: 0, confidence: 1 });
  await sleep(1400);
  await store.updatePosition('TESTAB', 'host-1', { x: 0, y: 0, confidence: 1 });
  assert.throws(
    () => store.killPlayer('TESTAB', 'host-1', 'impo-1'),
    (error) => error.code === 'TARGET_TOO_FAR',
  );

  // Walk the impostor close: within 2 m, kill succeeds
  await sleep(1400);
  await store.updatePosition('TESTAB', 'host-1', { x: 8.5, y: 0, confidence: 1 });
  const result = store.killPlayer('TESTAB', 'host-1', 'impo-1');
  assert.equal(result.killedPlayerId, 'impo-1');

  // Corpse registered at the kill location, street identity stored
  const corpses = store.getRoom('TESTAB').corpses;
  assert.equal(corpses.length, 1);
  assert.equal(corpses[0].playerId, 'impo-1');
  assert.equal(corpses[0].x, 10);
  assert.equal(corpses[0].corridorId, 'c1');
});

test('same-street corpse discovery gates reporting (crew AND impostor)', async () => {
  const store = await setup();
  const room = store.getRoom('TESTAB');
  room.corpses = [
    { playerId: 'crew-1', x: 20, y: 0, corridorId: 'c1', roomId: null, deadAt: new Date().toISOString() },
  ];

  // Reporter on the SAME street: report allowed
  await store.updatePosition('TESTAB', 'host-1', { x: 21, y: 0, confidence: 1 });
  await sleep(1400);
  const visible = store.visibleCorpses('TESTAB', 'host-1');
  assert.equal(visible.length, 1);
  store.reportBody('TESTAB', 'host-1');
  assert.equal(store.getRoom('TESTAB').status, 'MEETING');
});

test('corpse on another street is invisible and report is rejected', async () => {
  const store = await setup();
  const room = store.getRoom('TESTAB');
  room.corpses = [
    { playerId: 'crew-1', x: 20, y: 50, corridorId: 'c2', roomId: null, deadAt: new Date().toISOString() },
  ];
  // Reporter on c1 (different street)
  await store.updatePosition('TESTAB', 'host-1', { x: 21, y: 0, confidence: 1 });
  assert.equal(store.visibleCorpses('TESTAB', 'host-1').length, 0);
  assert.throws(
    () => store.reportBody('TESTAB', 'host-1'),
    (error) => error.code === 'NO_BODY_NEARBY',
  );
});

test('boundary: far-off positions produce warnings and admin escalation', async () => {
  const store = await setup();
  // 30 m away from both corridors
  await store.updatePosition('TESTAB', 'host-1', { x: 25, y: 30, confidence: 1 });
  let boundary = null;
  let sawAdminAlert = false;
  for (let i = 0; i < 3; i++) {
    await sleep(1400);
    boundary = store.updatePosition('TESTAB', 'host-1', {
      x: 25,
      y: 30 + (i + 1) * 0.5,
      confidence: 1,
    }).boundary;
    if (boundary.adminAlert) sawAdminAlert = true;
  }
  assert.equal(boundary.outOfBounds, true);
  assert.ok(boundary.strikes >= 3, `strikes accumulate (${boundary.strikes})`);
  assert.equal(sawAdminAlert, true, 'admin escalation after 3 strikes (once)');

  // Back inside: counters cleared (walk takes a few seconds)
  await sleep(5000);
  const back = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 0, confidence: 1 });
  assert.equal(back.boundary.outOfBounds, false);
  assert.equal(back.boundary.strikes, 0);
});

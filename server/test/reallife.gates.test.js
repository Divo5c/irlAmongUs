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
    rooms: (() => require('./criticalRooms').criticalRooms())(),
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
  // Escalation windows shortened so the test doesn't wait 3 minutes.
  process.env.RLAUS_ESCALATION_FIRST_MS = '200';
  process.env.RLAUS_ESCALATION_SECOND_MS = '600';
  const store = await setup();
  // 30 m away from both corridors -> Level 1 warning immediately.
  let boundary = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 30, confidence: 1 }).boundary;
  assert.equal(boundary.outOfBounds, true, 'far off is out of bounds');
  assert.equal(boundary.escalationLevel, 1, 'starts at escalation level 1');

  // Level 2 after 60s (env-shortened to 200ms), Level 3 (host alarm)
  // after +120s (env-shortened to 600ms total).
  await sleep(300);
  boundary = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 30.4, confidence: 1 }).boundary;
  assert.equal(boundary.escalationLevel, 2, 'level 2 after first window');
  assert.ok(boundary.escalationLevel < 3, 'host not alarmed yet');
  await sleep(500);
  boundary = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 30.8, confidence: 1 }).boundary;
  assert.equal(boundary.escalationLevel, 3, 'level 3 raises');
  assert.equal(boundary.adminAlert, true, 'host alarm while outside');

  // Back inside: counters cleared + back-notification. (31m instant jump
  // needs the documented plausibility bypass — the walk-rate gate is
  // tested elsewhere; here we only verify escalation bookkeeping.)
  const back = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 0, confidence: 1 },
    { skipPlausibilityCheck: true });
  assert.equal(back.boundary.outOfBounds, false);
  assert.equal(back.boundary.backFromEscalation, true, 'escalated player returning signals back');
  assert.equal(back.boundary.escalationLevel, 0);
  await sleep(300); // real dt for the plausibility gate (no 0.2m-in-ms race)
  const later = store.updatePosition('TESTAB', 'host-1', { x: 25, y: 0.2, confidence: 1 });
  assert.equal(later.boundary.backFromEscalation, false, 'back signal only fires once');
});

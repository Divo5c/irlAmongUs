const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RoomStore } = require('../src/rooms/roomStore');
const { panelLayout, REACTOR_HOLD_MS, REACTOR_HEARTBEAT_TIMEOUT_MS, O2_RETRY_MS } = require('../src/game/sabotagePanels');
const { pointInPolygon } = require('../src/game/positioning');
const { criticalRooms } = require('./criticalRooms');

const code = 'ABC234';
function setup(type, rooms = criticalRooms()) {
  const store = new RoomStore();
  const map = {
    nodes: [{ id: 'a', x: 10, y: 80 }, { id: 'b', x: 110, y: 80 }],
    corridors: [{ id: 'c', a: 'a', b: 'b' }],
    rooms, connections: [],
  };
  const room = store.createRoom({ code, hostId: 'host' });
  for (const id of ['p2', 'p3', 'p4']) store.addPlayerToRoom(code, { id, name: id });
  store.startMapSetup(code);
  store.saveMap(code, map);
  store.startGame(code);
  const impostor = room.players.find(({ role }) => role === 'IMPOSTOR').id;
  const crew = room.players.filter(({ role }) => role === 'CREWMATE').map(({ id }) => id);
  if (type) store.startSabotage(code, impostor, type);
  function place(player, spot, confidence = 1) {
    store.updatePosition(code, player, { x: spot.x, y: spot.y, confidence }, { skipPlausibilityCheck: true });
  }
  return { store, room, impostor, crew, place, map };
}

test('admin access uses the stored name, including case and surrounding spaces', () => {
  const { store, room, impostor } = setup(null);
  const player = room.players.find(({ id }) => id === impostor);
  for (const name of ['diraj', ' Diraj ', 'DIRAJ']) {
    player.name = name;
    assert.equal(store.isAdminPlayer(code, player.id), true);
  }
  for (const name of ['Diraj2', 'Dira']) {
    player.name = name;
    assert.throws(() => store.startAdminSabotage(code, player.id, 'reactor'), { code: 'REQUEST_REJECTED' });
  }
});

test('admin starts either sabotage with the normal panel state, ignoring role and cooldown', (t) => {
  const { store, room, crew, impostor, place } = setup(null);
  const player = room.players.find(({ id }) => id === crew[0]);
  player.name = 'Diraj';
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  for (const [type, role, isAlive] of [['reactor', 'CREWMATE', true], ['o2', 'IMPOSTOR', true], ['o2', 'CREWMATE', false]]) {
    const normal = store.startSabotage(code, impostor, type.toUpperCase());
    room.sabotage = null;
    const cooldown = room.sabotageCooldownUntil;
    const count = room.sabotageCount;
    Object.assign(player, { role, isAlive });
    const forced = store.startAdminSabotage(code, player.id, type);
    assert.equal(Date.parse(forced.deadline) - now, 90_000);
    const { roundId, ...panels } = forced.room.sabotage.panelStatus;
    const { roundId: normalRound, ...normalPanels } = normal.room.sabotage.panelStatus;
    assert.notEqual(roundId, normalRound);
    assert.deepEqual(panels, normalPanels);
    assert.deepEqual(forced.room.sabotage.fixSpots, normal.room.sabotage.fixSpots);
    assert.equal(room.sabotageCooldownUntil, cooldown);
    assert.equal(room.sabotageCount, count);
    const active = room.sabotage;
    assert.throws(() => store.startAdminSabotage(code, player.id, 'reactor'), { code: 'SABOTAGE_ACTIVE' });
    assert.equal(room.sabotage, active);
    if (type === 'o2') {
      const [first, second] = forced.room.sabotage.fixSpots;
      const [a, b] = crew.slice(1);
      place(a, first);
      place(b, second);
      const note = store.openSabotagePanel(code, a, roundId, first.id).note;
      assert.ok(/^[1-9]\d{4}$/.test(note));
      assert.equal('note' in forced.room.sabotage, false);
      assert.equal('controls' in forced.room.sabotage, false);
      store.submitOxygenPanel(code, a, roundId, first.id, note);
      store.openSabotagePanel(code, b, roundId, second.id);
      store.submitOxygenPanel(code, b, roundId, second.id, note);
      assert.equal(room.sabotageCooldownUntil, cooldown);
    }
    room.sabotage = null;
    room.sabotageCooldownUntil = 0;
  }
});

test('admin requests still require an active game, compatible map and supported type', () => {
  const { store, room, impostor } = setup(null);
  const player = room.players.find(({ id }) => id === impostor);
  player.name = 'Diraj';
  for (const phase of ['LOBBY', 'MEETING', 'GAME_OVER']) {
    room.status = phase;
    assert.throws(() => store.startAdminSabotage(code, player.id, 'reactor'), { code: 'NOT_IN_GAME' });
  }
  room.status = 'IN_GAME';
  for (const type of [null, 1, {}, 'REACTOR', 'lights']) {
    assert.throws(() => store.startAdminSabotage(code, player.id, type), { code: 'SABOTAGE_INVALID_TYPE' });
  }
  room.sabotage = { type: 'LIGHTS', deadline: null };
  assert.throws(() => store.startAdminSabotage(code, player.id, 'o2'), { code: 'SABOTAGE_ACTIVE' });
  room.sabotage = null;
  room.map = { ...room.map, rooms: room.map.rooms.filter(({ type }) => type !== 'ADMIN' && type !== 'REACTOR') };
  for (const type of ['reactor', 'o2']) {
    assert.throws(() => store.startAdminSabotage(code, player.id, type), { code: 'SABOTAGE_UNAVAILABLE' });
  }
});

test('deterministic reactor panels sit inside the polygon and small rooms keep their maps', () => {
  const map = { rooms: criticalRooms() };
  const [first, second] = panelLayout(map).REACTOR;
  assert.deepEqual(panelLayout(structuredClone(map)), panelLayout(map));
  for (const spot of [first, second]) assert.equal(pointInPolygon(spot.x, spot.y, map.rooms[1].polygon), true);
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 10);
  const rooms = criticalRooms();
  rooms[1].polygon = [{ x: 36, y: 100 }, { x: 40, y: 100 }, { x: 40, y: 104 }, { x: 36, y: 104 }];
  const { room, store, impostor } = setup(null, rooms);
  assert.ok(room.map.rooms.find(({ type }) => type === 'REACTOR'));
  assert.deepEqual(store.toPublicRoom(room).sabotageTypes, ['O2']);
  assert.throws(() => store.startSabotage(code, impostor, 'REACTOR'), { code: 'SABOTAGE_UNAVAILABLE' });
});

test('oxygen panels require distinct locations with edge clearance', () => {
  const rooms = criticalRooms();
  const { O2: [oxygen, admin] } = panelLayout({ rooms });
  assert.ok(Math.hypot(oxygen.x - admin.x, oxygen.y - admin.y) >= 10);
  rooms[2].polygon = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }];
  const { store, room, impostor } = setup(null, rooms);
  assert.ok(room.map.rooms.find(({ type }) => type === 'O2'));
  assert.equal(store.toPublicRoom(room).sabotageTypes.includes('O2'), false);
  assert.throws(() => store.startSabotage(code, impostor, 'O2'), { code: 'SABOTAGE_UNAVAILABLE' });
});

test('a lone player can open, hold and release a reactor scanner in overlapping rooms', () => {
  const rooms = criticalRooms();
  rooms[0].polygon = rooms[1].polygon;
  const { store, room, impostor, place } = setup('REACTOR', rooms);
  const { id, spots: [scanner] } = room.sabotage.controls;
  const now = Date.now();
  place(impostor, scanner);
  assert.equal(store.getPlayerPosition(code, impostor).roomId, rooms[0].id);
  const opened = store.openSabotagePanel(code, impostor, id, scanner.id, now);
  assert.deepEqual(opened.status.panels.map(({ state }) => state), ['OPEN', 'OPEN']);
  store.holdSabotagePanel(code, impostor, id, scanner.id, true, now);
  store.holdSabotagePanel(code, impostor, id, scanner.id, true, now + 500);
  const alone = store.tickReactorPanels(code, now + 1500);
  assert.deepEqual(alone.status.panels.map(({ state }) => state), ['HELD', 'OPEN']);
  assert.equal(alone.status.progress, 0);
  assert.equal(alone.fixed, undefined);
  store.holdSabotagePanel(code, impostor, id, scanner.id, false, now + 1501);
  assert.deepEqual(store.tickReactorPanels(code, now + 1501).status.panels.map(({ state }) => state), ['OPEN', 'OPEN']);
  assert.equal(room.sabotage.controls.open.get(impostor), scanner.id);
});

test('reactor requires two live nearby players at separate panels and continuous holds', () => {
  const { store, room, crew: [a, b, ghost], place } = setup('REACTOR');
  const { id, spots: [left, right] } = room.sabotage.controls;
  const now = Date.now();
  const open = (player, spot) => store.openSabotagePanel(code, player, id, spot.id, now);
  const hold = (player, spot, offset, active = true) =>
    store.holdSabotagePanel(code, player, id, spot.id, active, now + offset);
  assert.throws(() => open(a, left), { code: 'SABOTAGE_NOT_AT_PANEL' });
  place(a, left, 0.1);
  assert.throws(() => open(a, left), { code: 'SABOTAGE_NOT_AT_PANEL' });
  place(a, left);
  place(b, right);
  place(ghost, left);
  room.players.find(({ id: player }) => player === ghost).isAlive = false;
  assert.throws(() => open(ghost, left), { code: 'PLAYER_DEAD' });
  open(a, left);
  open(b, right);
  hold(a, left, 0);
  assert.throws(() => hold(a, right, 0), { code: 'SABOTAGE_NOT_AT_PANEL' });
  hold(b, right, 0);
  assert.ok(store.tickReactorPanels(code, now + 300).status.progress > 0);
  hold(a, left, 300, false);
  assert.equal(store.tickReactorPanels(code, now + 350).status.progress, 0);
  hold(a, left, 400);
  hold(a, left, 900);
  hold(b, right, 900);
  assert.equal(store.tickReactorPanels(code, now + 400 + REACTOR_HOLD_MS).status.progress, 1);
  assert.equal(room.sabotage, null);
  assert.equal(store.tickReactorPanels(code), null);
  assert.throws(() => hold(a, left, 2000), { code: 'NO_SABOTAGE' });
});

test('reactor loses the hold when the player leaves or heartbeats expire', () => {
  const { store, room, crew: [a, b], place } = setup('REACTOR');
  const { id, spots } = room.sabotage.controls;
  const now = Date.now();
  for (const [i, player] of [a, b].entries()) {
    place(player, spots[i]);
    store.openSabotagePanel(code, player, id, spots[i].id, now);
    store.holdSabotagePanel(code, player, id, spots[i].id, true, now);
  }
  place(a, { x: 20, y: 80 });
  const moved = store.tickReactorPanels(code, now + 500);
  assert.equal(moved.status.progress, 0);
  assert.equal(moved.status.panels[0].state, 'OPEN');
  const timedOut = store.tickReactorPanels(code, now + REACTOR_HEARTBEAT_TIMEOUT_MS);
  assert.equal(timedOut.status.panels[1].state, 'OPEN');
  assert.ok(room.sabotage);
});

for (const order of [[0, 1], [1, 0]]) {
  test(`oxygen solves in either order (first panel ${order[0] + 1})`, () => {
    const { store, room, crew: [a, b, ghost], impostor, place } = setup('O2');
    const { id, spots } = room.sabotage.controls;
    const now = Date.now();
    const first = spots[order[0]], second = spots[order[1]];
    const open = (player, spot) => store.openSabotagePanel(code, player, id, spot.id, now);
    const submit = (player, spot, digits, offset = 0) =>
      store.submitOxygenPanel(code, player, id, spot.id, digits, now + offset);
    assert.throws(() => open(a, first), { code: 'SABOTAGE_NOT_AT_PANEL' });
    place(a, first);
    place(b, second);
    place(ghost, first);
    room.players.find(({ id: player }) => player === ghost).isAlive = false;
    assert.throws(() => open(ghost, first), { code: 'PLAYER_DEAD' });
    const note = open(a, first).note;
    assert.match(note, /^[1-9]\d{4}$/);
    assert.equal(open(b, second).note, note);
    const publicSabotage = store.toPublicRoom(room).sabotage;
    assert.equal('controls' in publicSabotage, false);
    assert.equal('note' in publicSabotage.panelStatus, false);
    for (const invalid of [12345, 'abc', '123456']) {
      assert.throws(() => submit(a, first, invalid), { code: 'SABOTAGE_INVALID_INPUT' });
    }
    assert.equal(submit(a, first, '0').result, 'BAD');
    assert.equal(submit(a, first, note, O2_RETRY_MS - 1).result, 'BAD');
    assert.equal(submit(a, first, note, O2_RETRY_MS).result, 'OK');
    assert.equal(open(a, first).note, undefined);
    assert.equal(room.sabotage.panels[first.id], true);
    assert.equal(submit(b, second, note, O2_RETRY_MS).result, 'OK');
    assert.equal(room.sabotage, null);
    room.sabotageCooldownUntil = 0;
    store.startSabotage(code, impostor, 'O2');
    assert.notEqual(room.sabotage.controls.code, note);
  });
}

for (const type of ['REACTOR', 'O2']) {
  test(`report removes all ${type} panel state`, () => {
    const { store, room, crew: [a], place } = setup(type);
    const { id, spots: [spot] } = room.sabotage.controls;
    place(a, spot);
    store.openSabotagePanel(code, a, id, spot.id);
    room.corpses = [{ playerId: 'victim', roomId: spot.roomId, x: spot.x, y: spot.y }];
    store.reportBody(code, a);
    assert.equal(room.sabotage, null);
    assert.equal(store.tickReactorPanels(code), null);
    assert.throws(() => store.openSabotagePanel(code, a, id, spot.id), { code: 'NOT_IN_GAME' });
  });
}

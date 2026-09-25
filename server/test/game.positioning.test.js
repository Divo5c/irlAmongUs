const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  pointInPolygon,
  isPointOnEdge,
  pointToSegmentDistance,
  snapToCorridor,
  resolveRoomMembership,
  sanitizePositionEstimate,
  distance,
  isPositionPlausible,
  MAX_SNAP_DISTANCE,
} = require('../src/game/positioning');

const {
  isWithinDistance,
  canKill,
  canReport,
  DEFAULT_KILL_DISTANCE,
  DEFAULT_REPORT_DISTANCE,
} = require('../src/game/proximity');

const { RoomStore } = require('../src/rooms/roomStore');

// ──────────────────────────────────────────────────────────── helpers ──────

const SQUARE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const TRIANGLE = [
  { x: 5, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

const CONCAVE = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 5, y: 5 },
  { x: 5, y: 10 },
  { x: 0, y: 10 },
];

function makeMap(overrides = {}) {
  return {
    version: 1,
    nodes: overrides.nodes || [
      { id: 'n1', x: 0, y: 0 },
      { id: 'n2', x: 20, y: 0 },
      { id: 'n3', x: 20, y: 20 },
    ],
    corridors: overrides.corridors || [
      { id: 'c1', a: 'n1', b: 'n2' },
      { id: 'c2', a: 'n2', b: 'n3' },
    ],
    rooms: overrides.rooms || [],
    connections: overrides.connections || [],
  };
}

// ──────────────────────────────────────────────── pointInPolygon ───────────

describe('pointInPolygon', () => {
  test('inside a square', () => {
    assert.equal(pointInPolygon(5, 5, SQUARE), true);
  });

  test('outside a square', () => {
    assert.equal(pointInPolygon(15, 5, SQUARE), false);
  });

  test('outside far away', () => {
    assert.equal(pointInPolygon(100, 100, SQUARE), false);
  });

  test('inside a triangle', () => {
    assert.equal(pointInPolygon(5, 6, TRIANGLE), true);
  });

  test('outside a triangle', () => {
    // (5, 2) is inside the triangle (5,0)-(10,10)-(0,10)
    // Use a point clearly outside: (15, 5)
    assert.equal(pointInPolygon(15, 5, TRIANGLE), false);
  });

  test('inside a concave polygon', () => {
    // (2, 7) is inside the concave shape
    assert.equal(pointInPolygon(2, 7, CONCAVE), true);
  });

  test('outside the concave notch', () => {
    // (7, 7) is in the notch cutout
    assert.equal(pointInPolygon(7, 7, CONCAVE), false);
  });

  test('point on edge is inside', () => {
    assert.equal(pointInPolygon(5, 0, SQUARE), true);
    assert.equal(pointInPolygon(10, 5, SQUARE), true);
    assert.equal(pointInPolygon(0, 5, SQUARE), true);
    assert.equal(pointInPolygon(5, 10, SQUARE), true);
  });

  test('point on vertex is inside', () => {
    assert.equal(pointInPolygon(0, 0, SQUARE), true);
    assert.equal(pointInPolygon(10, 10, SQUARE), true);
  });

  test('negative coordinates', () => {
    const negativeSquare = SQUARE.map(p => ({ x: p.x - 20, y: p.y - 20 }));
    assert.equal(pointInPolygon(-15, -15, negativeSquare), true);
    assert.equal(pointInPolygon(5, 5, negativeSquare), false);
  });

  test('empty polygon returns false', () => {
    assert.equal(pointInPolygon(5, 5, []), false);
    assert.equal(pointInPolygon(5, 5, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), false);
  });
});

// ─────────────────────────────────────────── pointToSegmentDistance ────────

describe('pointToSegmentDistance', () => {
  test('perpendicular distance to horizontal segment', () => {
    const result = pointToSegmentDistance(5, 5, 0, 0, 10, 0);
    assert.equal(result.distance, 5);
    assert.equal(result.closestX, 5);
    assert.equal(result.closestY, 0);
  });

  test('clamped to segment start', () => {
    const result = pointToSegmentDistance(-5, 5, 0, 0, 10, 0);
    assert.equal(result.distance, Math.hypot(5, 5));
    assert.equal(result.closestX, 0);
    assert.equal(result.closestY, 0);
  });

  test('clamped to segment end', () => {
    const result = pointToSegmentDistance(15, 5, 0, 0, 10, 0);
    assert.equal(result.distance, Math.hypot(5, 5));
    assert.equal(result.closestX, 10);
    assert.equal(result.closestY, 0);
  });

  test('point on segment', () => {
    const result = pointToSegmentDistance(5, 0, 0, 0, 10, 0);
    assert.equal(result.distance, 0);
  });
});

// ─────────────────────────────────────────────── snapToCorridor ────────────

describe('snapToCorridor', () => {
  const map = makeMap();

  test('snaps a point near a corridor', () => {
    const result = snapToCorridor(10, 2, map);
    assert.ok(result !== null);
    assert.equal(result.distance <= MAX_SNAP_DISTANCE, true);
    assert.equal(result.x, 10);
    assert.equal(result.y, 0);
  });

  test('returns null when too far from all corridors', () => {
    const result = snapToCorridor(100, 100, map);
    assert.equal(result, null);
  });

  test('returns null for null map', () => {
    assert.equal(snapToCorridor(5, 5, null), null);
  });

  test('snaps to nearest corridor when between two', () => {
    // Point at (20, 5) is between c1 (n1→n2) and c2 (n2→n3)
    const result = snapToCorridor(20, 5, map);
    assert.ok(result !== null);
    assert.ok(result.corridorId === 'c1' || result.corridorId === 'c2');
  });

  test('snaps exactly at a node', () => {
    const result = snapToCorridor(20, 0, map);
    assert.ok(result !== null);
    assert.equal(result.x, 20);
    assert.equal(result.y, 0);
  });
});

// ──────────────────────────────────────── resolveRoomMembership ────────────

describe('resolveRoomMembership', () => {
  test('point inside a room returns roomId', () => {
    const map = makeMap({
      rooms: [{
        id: 'r1',
        name: 'Lab',
        type: 'SECURITY',
        polygon: [{ x: 0, y: 12 }, { x: 8, y: 12 }, { x: 8, y: 20 }, { x: 0, y: 20 }],
      }],
    });
    const result = resolveRoomMembership(4, 16, map);
    assert.equal(result.roomId, 'r1');
    assert.equal(result.onCorridor, false);
  });

  test('point on corridor returns onCorridor=true', () => {
    const map = makeMap();
    const result = resolveRoomMembership(10, 1, map);
    assert.equal(result.roomId, null);
    assert.equal(result.onCorridor, true);
  });

  test('point far from everything returns no match', () => {
    const map = makeMap();
    const result = resolveRoomMembership(100, 100, map);
    assert.equal(result.roomId, null);
    assert.equal(result.onCorridor, false);
  });

  test('null map returns passthrough', () => {
    const result = resolveRoomMembership(5, 5, null);
    assert.equal(result.roomId, null);
    assert.equal(result.snappedX, 5);
    assert.equal(result.snappedY, 5);
  });
});

// ──────────────────────────────────────── sanitizePositionEstimate ──────────

describe('sanitizePositionEstimate', () => {
  test('valid estimate passes through', () => {
    const result = sanitizePositionEstimate({
      x: 10, y: 20, heading: 90, confidence: 0.8, source: 'IMU',
    });
    assert.equal(result.x, 10);
    assert.equal(result.y, 20);
    assert.equal(result.heading, 90);
    assert.equal(result.confidence, 0.8);
    assert.equal(result.source, 'IMU');
    assert.ok(typeof result.timestamp === 'number');
  });

  test('null heading is accepted', () => {
    const result = sanitizePositionEstimate({ x: 5, y: 5, heading: null });
    assert.equal(result.heading, null);
  });

  test('invalid heading becomes null', () => {
    const result = sanitizePositionEstimate({ x: 5, y: 5, heading: -10 });
    assert.equal(result.heading, null);
  });

  test('heading > 360 becomes null', () => {
    const result = sanitizePositionEstimate({ x: 5, y: 5, heading: 400 });
    assert.equal(result.heading, null);
  });

  test('confidence clamped to [0,1]', () => {
    // Negative confidence is invalid, defaults to 0.5
    assert.equal(sanitizePositionEstimate({ x: 0, y: 0, confidence: -5 }).confidence, 0.5);
    assert.equal(sanitizePositionEstimate({ x: 0, y: 0, confidence: 999 }).confidence, 1);
  });

  test('NaN confidence defaults to 0.5', () => {
    assert.equal(sanitizePositionEstimate({ x: 0, y: 0, confidence: 'abc' }).confidence, 0.5);
  });

  test('invalid source defaults to FUSED', () => {
    assert.equal(sanitizePositionEstimate({ x: 0, y: 0, source: 'MAGIC' }).source, 'FUSED');
  });

  test('valid sources are accepted', () => {
    for (const src of ['IMU', 'GPS', 'BLE', 'WIFI', 'UWB', 'AR', 'FUSED', 'MANUAL_DEBUG']) {
      assert.equal(sanitizePositionEstimate({ x: 0, y: 0, source: src }).source, src);
    }
  });

  test('NaN coordinates throw', () => {
    assert.throws(() => sanitizePositionEstimate({ x: NaN, y: 0 }));
    assert.throws(() => sanitizePositionEstimate({ x: 0, y: Infinity }));
  });

  test('out of bounds throws', () => {
    assert.throws(() => sanitizePositionEstimate({ x: 60000, y: 0 }));
    assert.throws(() => sanitizePositionEstimate({ x: 0, y: -60000 }));
  });

  test('non-object input throws', () => {
    assert.throws(() => sanitizePositionEstimate(null));
    assert.throws(() => sanitizePositionEstimate([1, 2]));
  });
});

// ──────────────────────────────────────────────── distance ─────────────────

describe('distance', () => {
  test('same point', () => {
    assert.equal(distance({ x: 5, y: 5 }, { x: 5, y: 5 }), 0);
  });

  test('known distance', () => {
    assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });

  test('symmetric', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    assert.equal(distance(a, b), distance(b, a));
  });
});

// ──────────────────────────────────────── isPositionPlausible ──────────────

describe('isPositionPlausible', () => {
  test('first position is always valid', () => {
    assert.equal(isPositionPlausible({ x: 0, y: 0, timestamp: 1000 }, null).valid, true);
  });

  test('clock jump is rejected', () => {
    const prev = { x: 0, y: 0, timestamp: 2000 };
    const curr = { x: 0, y: 0, timestamp: 1000 };
    const result = isPositionPlausible(curr, prev);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'POSITION_CLOCK_JUMP');
  });

  test('realistic walking speed is accepted', () => {
    const prev = { x: 0, y: 0, timestamp: 1000 };
    const curr = { x: 5, y: 0, timestamp: 2000 }; // 5m/s = running
    assert.equal(isPositionPlausible(curr, prev).valid, true);
  });

  test('unrealistic speed is rejected', () => {
    const prev = { x: 0, y: 0, timestamp: 1000 };
    const curr = { x: 100, y: 0, timestamp: 1100 }; // 100m/s
    const result = isPositionPlausible(curr, prev);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'POSITION_UNREALISTIC');
  });

  test('stationary is valid', () => {
    const prev = { x: 5, y: 5, timestamp: 1000 };
    const curr = { x: 5, y: 5, timestamp: 2000 };
    assert.equal(isPositionPlausible(curr, prev).valid, true);
  });
});

// ─────────────────────────────────────────── proximity ─────────────────────

describe('isWithinDistance', () => {
  test('within range', () => {
    const result = isWithinDistance({ x: 0, y: 0 }, { x: 2, y: 0 }, 5);
    assert.equal(result.within, true);
    assert.equal(result.actualDistance, 2);
  });

  test('out of range', () => {
    const result = isWithinDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    assert.equal(result.within, false);
  });

  test('exact boundary', () => {
    const result = isWithinDistance({ x: 0, y: 0 }, { x: 5, y: 0 }, 5);
    assert.equal(result.within, true);
  });
});

describe('canKill', () => {
  const pos = { x: 0, y: 0, confidence: 0.8 };
  const near = { x: 2, y: 0, confidence: 0.8 };
  const far = { x: 10, y: 0, confidence: 0.8 };

  test('allows kill within distance', () => {
    const result = canKill({ killerPos: pos, targetPos: near });
    assert.equal(result.allowed, true);
  });

  test('rejects kill out of distance', () => {
    const result = canKill({ killerPos: pos, targetPos: far });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'TOO_FAR');
  });

  test('rejects when killer position unknown', () => {
    const result = canKill({ killerPos: null, targetPos: near });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'POSITION_MISSING');
  });

  test('rejects low confidence', () => {
    const result = canKill({
      killerPos: { x: 0, y: 0, confidence: 0.1 },
      targetPos: near,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'KILLER_CONFIDENCE_TOO_LOW');
  });
});

describe('canReport', () => {
  const reporter = { x: 0, y: 0, confidence: 0.8 };
  const body = { x: 3, y: 0, confidence: 0.8 };
  const farBody = { x: 20, y: 0, confidence: 0.8 };

  test('allows report within distance', () => {
    const result = canReport({ reporterPos: reporter, bodyPos: body });
    assert.equal(result.allowed, true);
  });

  test('rejects report out of distance', () => {
    const result = canReport({ reporterPos: reporter, bodyPos: farBody });
    assert.equal(result.allowed, false);
  });
});

// ──────────────────────────────────── RoomStore integration ────────────────

describe('RoomStore.updatePosition', () => {
  function makeReadyStore() {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.addPlayerToRoom('ABC234', { id: 'p2', name: 'P2' });
    store.startMapSetup('ABC234');
    store.updateMap('ABC234', {
      nodes: [
        { id: 'n1', x: 0, y: 0 },
        { id: 'n2', x: 20, y: 0 },
      ],
      corridors: [{ id: 'c1', a: 'n1', b: 'n2' }],
      rooms: [{
        id: 'r1',
        name: 'Lab',
        type: 'SECURITY',
        polygon: [
          { x: -10, y: -10 },
          { x: -5, y: -10 },
          { x: -5, y: -5 },
          { x: -10, y: -5 },
        ],
      }],
      connections: [],
    });
    store.saveMap('ABC234');
    return store;
  }

  test('position update in MAP_READY succeeds', () => {
    const store = makeReadyStore();
    const result = store.updatePosition('ABC234', 'host-1', {
      x: 10, y: 0, heading: 90, confidence: 0.7, source: 'IMU',
    });
    assert.equal(result.position.x, 10);
    assert.equal(result.position.y, 0);
    // Point on corridor — roomId may be null, but onCorridor should be true
    assert.equal(result.onCorridor, true);
  });

  test('position update in LOBBY throws', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assert.throws(
      () => store.updatePosition('ABC234', 'host-1', { x: 0, y: 0 }),
      (err) => err.code === 'POSITION_NOT_ALLOWED',
    );
  });

  test('unknown player throws', () => {
    const store = makeReadyStore();
    assert.throws(
      () => store.updatePosition('ABC234', 'unknown', { x: 0, y: 0 }),
    );
  });

  test('room membership resolves for point in room', () => {
    const store = makeReadyStore();
    const result = store.updatePosition('ABC234', 'host-1', {
      x: -7, y: -7, confidence: 0.8, source: 'MANUAL_DEBUG',
    });
    assert.equal(result.roomId, 'r1');
    assert.equal(result.onCorridor, false);
  });

  test('room membership resolves for corridor point', () => {
    const store = makeReadyStore();
    const result = store.updatePosition('ABC234', 'host-1', {
      x: 10, y: 1, confidence: 0.8, source: 'MANUAL_DEBUG',
    });
    assert.equal(result.roomId, null);
    assert.equal(result.onCorridor, true);
  });

  test('position plausibility check rejects speed hack', () => {
    const store = makeReadyStore();
    // Two updates with same timestamp won't trigger speed check (dtMs=0).
    // Test the plausibility function directly instead.
    const prev = { x: 0, y: 0, timestamp: 1000 };
    const curr = { x: 100, y: 0, timestamp: 1100 };
    const result = isPositionPlausible(curr, prev);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'POSITION_UNREALISTIC');
  });

  test('getPlayerPosition returns confirmed position', () => {
    const store = makeReadyStore();
    store.updatePosition('ABC234', 'host-1', {
      x: -7, y: -7, heading: 180, confidence: 0.9, source: 'IMU',
    });
    const pos = store.getPlayerPosition('ABC234', 'host-1');
    assert.ok(pos);
    assert.equal(pos.x, -7);
    assert.equal(pos.heading, 180);
    assert.equal(pos.roomId, 'r1');
  });

  test('getPlayerPosition returns null for no update', () => {
    const store = makeReadyStore();
    assert.equal(store.getPlayerPosition('ABC234', 'host-1'), null);
  });

  test('getAdminPositions returns all players', () => {
    const store = makeReadyStore();
    store.updatePosition('ABC234', 'host-1', {
      x: 0, y: 0, confidence: 0.8, source: 'MANUAL_DEBUG',
    });
    store.updatePosition('ABC234', 'p2', {
      x: 10, y: 0, confidence: 0.6, source: 'MANUAL_DEBUG',
    });
    const positions = store.getAdminPositions('ABC234');
    assert.equal(positions.length, 2);
    assert.ok(positions.some(p => p.playerId === 'host-1'));
    assert.ok(positions.some(p => p.playerId === 'p2'));
  });

  test('positions are cleared on rematch', () => {
    const store = makeReadyStore();
    store.updatePosition('ABC234', 'host-1', {
      x: 5, y: 5, confidence: 0.8, source: 'MANUAL_DEBUG',
    });

    store.startGame('ABC234');
    store.endGame('ABC234', 'CREWMATE');
    store.resetToLobby('ABC234');

    assert.equal(store.getPlayerPosition('ABC234', 'host-1'), null);
  });
});

// ──────────────────────────────────── RoomStore admin auth ─────────────────

describe('RoomStore admin auth', () => {
  test('host can authenticate with correct PIN', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assert.equal(store.authenticateAdmin('ABC234', 'host-1', 'ABC234'), true);
    assert.equal(store.isAdmin('ABC234', 'host-1'), true);
  });

  test('wrong PIN is rejected', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assert.throws(
      () => store.authenticateAdmin('ABC234', 'host-1', 'WRONG'),
      (err) => err.code === 'ADMIN_AUTH_FAILED',
    );
    assert.equal(store.isAdmin('ABC234', 'host-1'), false);
  });

  test('non-host cannot authenticate', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.addPlayerToRoom('ABC234', { id: 'p2', name: 'P2' });
    assert.throws(
      () => store.authenticateAdmin('ABC234', 'p2', 'ABC234'),
      (err) => err.code === 'NOT_ROOM_HOST',
    );
    assert.equal(store.isAdmin('ABC234', 'p2'), false);
  });

  test('admin auth is revoked on rematch', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.addPlayerToRoom('ABC234', { id: 'p2', name: 'P2' });
    store.authenticateAdmin('ABC234', 'host-1', 'ABC234');

    store.startMapSetup('ABC234');
    store.updateMap('ABC234', {
      nodes: [{ id: 'n1', x: 0, y: 0 }, { id: 'n2', x: 10, y: 0 }],
      corridors: [{ id: 'c1', a: 'n1', b: 'n2' }],
      rooms: [],
      connections: [],
    });
    store.saveMap('ABC234');
    store.startGame('ABC234');
    store.endGame('ABC234', 'CREWMATE');
    store.resetToLobby('ABC234');

    assert.equal(store.isAdmin('ABC234', 'host-1'), false);
  });
});

// ──────────────────────────────── RoomStore admin PIN security ───────────────

describe('RoomStore admin PIN security', () => {
  test('host can set a custom admin PIN', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assert.equal(store.setAdminPin('ABC234', 'host-1', 'MYSECRET'), true);
    assert.equal(store.getRoom('ABC234').adminPinHash !== null, true);
  });

  test('non-host cannot set admin PIN', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.addPlayerToRoom('ABC234', { id: 'p2', name: 'P2' });
    assert.throws(
      () => store.setAdminPin('ABC234', 'p2', 'MYSECRET'),
      (err) => err.code === 'NOT_ROOM_HOST',
    );
  });

  test('PIN must be at least 4 characters', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    assert.throws(
      () => store.setAdminPin('ABC234', 'host-1', 'AB'),
      (err) => err.code === 'INVALID_PIN',
    );
  });

  test('authenticateAdmin with custom PIN succeeds', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.setAdminPin('ABC234', 'host-1', 'MYSECRET');
    assert.equal(store.authenticateAdmin('ABC234', 'host-1', 'MYSECRET'), true);
    assert.equal(store.isAdmin('ABC234', 'host-1'), true);
  });

  test('authenticateAdmin with room code fails after custom PIN is set', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    store.setAdminPin('ABC234', 'host-1', 'MYSECRET');
    assert.throws(
      () => store.authenticateAdmin('ABC234', 'host-1', 'ABC234'),
      (err) => err.code === 'ADMIN_AUTH_FAILED',
    );
  });

  test('authenticateAdmin with room code fallback when no custom PIN set', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    // No setAdminPin called — fallback to room code
    assert.equal(store.authenticateAdmin('ABC234', 'host-1', 'ABC234'), true);
    assert.equal(store.isAdmin('ABC234', 'host-1'), true);
  });

  test('adminPinSet flag in public room', () => {
    const store = new RoomStore();
    store.createRoom({ code: 'ABC234', hostId: 'host-1' });
    const before = store.toPublicRoom(store.getRoom('ABC234'));
    assert.equal(before.adminPinSet, false);

    store.setAdminPin('ABC234', 'host-1', 'MYSECRET');
    const after = store.toPublicRoom(store.getRoom('ABC234'));
    assert.equal(after.adminPinSet, true);
  });
});

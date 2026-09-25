const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAP_LIMITS,
  ROOM_TYPES,
  sanitizeGameMap,
  validateForSave,
} = require('../src/game/map');
const { GameError } = require('../src/game/errors');

const VALID_MAP = {
  nodes: [
    { id: 'n1', x: 10, y: 50 },
    { id: 'n2', x: 90, y: 50 },
    { id: 'n3', x: 90, y: 10 },
  ],
  corridors: [
    { id: 'c1', a: 'n1', b: 'n2' },
    { id: 'c2', a: 'n2', b: 'n3' },
  ],
  rooms: [
    {
      id: 'r1',
      name: 'Chemistry Room',
      type: 'SECURITY',
      polygon: [
        { x: 70, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 20 },
        { x: 70, y: 20 },
      ],
    },
  ],
  connections: [{ roomId: 'r1', nodeId: 'n3' }],
};

function expectMapInvalid(fn, field) {
  assert.throws(
    fn,
    (error) =>
      error instanceof GameError &&
      error.code === 'MAP_INVALID' &&
      (field === undefined || error.details?.field === field),
  );
}

describe('map sanitizing accepts valid maps', () => {
  test('full example with rooms and connections passes unchanged', () => {
    const map = sanitizeGameMap(VALID_MAP);

    assert.equal(map.nodes.length, 3);
    assert.equal(map.corridors.length, 2);
    assert.equal(map.rooms.length, 1);
    assert.equal(map.rooms[0].type, 'SECURITY');
    assert.deepEqual(map.connections, [{ roomId: 'r1', nodeId: 'n3' }]);
    // version is assigned by the store, never trusted from the payload:
    assert.equal(map.version, 1);
  });

  test('empty structure is structurally valid (but not saveable)', () => {
    const map = sanitizeGameMap({ nodes: [], corridors: [], rooms: [], connections: [] });
    assert.deepEqual(map.rooms, []);
    assert.throws(() => validateForSave(map), /corridor/);
  });

  test('unknown extra keys are dropped', () => {
    const raw = {
      ...structuredClone(VALID_MAP),
      hackerField: true,
      nodes: [
        { id: 'n1', x: 10, y: 50, evil: 'x' },
        { id: 'n2', x: 90, y: 50 },
        { id: 'n3', x: 90, y: 10 },
      ],
    };
    const map = sanitizeGameMap(raw);
    assert.equal('hackerField' in map, false);
    assert.equal('evil' in map.nodes[0], false);
  });
});

describe('map sanitizing rejects invalid payloads', () => {
  test('non-object payloads', () => {
    expectMapInvalid(() => sanitizeGameMap('nope'), 'map');
    expectMapInvalid(() => sanitizeGameMap(null), 'map');
  });

  test('coordinate bounds and finiteness', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          nodes: [{ id: 'n1', x: MAP_LIMITS.COORD_ABS + 1, y: 0 }],
        }),
      'node.x',
    );
    expectMapInvalid(
      () => sanitizeGameMap({ ...VALID_MAP, nodes: [{ id: 'n1', x: 'left', y: 0 }] }),
      'node.x',
    );
    expectMapInvalid(
      () => sanitizeGameMap({ ...VALID_MAP, nodes: [{ id: 'n1', x: NaN, y: 0 }] }),
      'node.x',
    );
  });

  test('duplicate node ids', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          nodes: [
            { id: 'n1', x: 0, y: 0 },
            { id: 'n1', x: 1, y: 1 },
          ],
        }),
      'duplicate',
    );
  });

  test('invalid ids (bad characters / too long)', () => {
    expectMapInvalid(
      () => sanitizeGameMap({ ...VALID_MAP, nodes: [{ id: 'bad id!', x: 0, y: 0 }] }),
      'node.id',
    );
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          nodes: [{ id: 'x'.repeat(MAP_LIMITS.ID_LENGTH + 1), x: 0, y: 0 }],
        }),
      'node.id',
    );
  });

  test('corridor references must exist and cannot loop a single node', () => {
    expectMapInvalid(
      () => sanitizeGameMap({ ...VALID_MAP, corridors: [{ id: 'cX', a: 'n1', b: 'ghost' }] }),
      'corridors',
    );
    expectMapInvalid(
      () => sanitizeGameMap({ ...VALID_MAP, corridors: [{ id: 'cX', a: 'n1', b: 'n1' }] }),
      'corridors',
    );
  });

  test('duplicate corridor between the same two nodes is rejected', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          corridors: [
            { id: 'cA', a: 'n1', b: 'n2' },
            { id: 'cB', b: 'n1', a: 'n2' }, // same pair, other direction
          ],
        }),
      'duplicate',
    );
  });

  test('room name length and invalid roles are rejected', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          rooms: [{ ...VALID_MAP.rooms[0], name: '' }],
        }),
      'room.name',
    );
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          rooms: [{ ...VALID_MAP.rooms[0], type: 'SECRET_LAB' }],
        }),
      'room.type',
    );
    assert.ok(ROOM_TYPES.includes('NORMAL'));
  });

  test('open/too-small polygons are rejected', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          rooms: [{ ...VALID_MAP.rooms[0], polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
        }),
      'room.polygon',
    );
  });

  test('connections must reference existing rooms and nodes', () => {
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          connections: [{ roomId: 'ghost', nodeId: 'n1' }],
        }),
      'connections',
    );
  });

  test('limits: too many nodes / rooms / polygon points', () => {
    const manyNodes = [];
    for (let i = 0; i <= MAP_LIMITS.NODES; i += 1) {
      manyNodes.push({ id: `n${i}`, x: i, y: 0 });
    }
    expectMapInvalid(() => sanitizeGameMap({ ...VALID_MAP, nodes: manyNodes }), 'limits');

    const manyRooms = [];
    for (let i = 0; i <= MAP_LIMITS.ROOMS; i += 1) {
      manyRooms.push({ ...VALID_MAP.rooms[0], id: `r${i}`, name: `R${i}` });
    }
    expectMapInvalid(() => sanitizeGameMap({ ...VALID_MAP, rooms: manyRooms }), 'limits');

    const bigPolygon = [];
    for (let i = 0; i <= MAP_LIMITS.POLYGON_POINTS; i += 1) {
      bigPolygon.push({ x: i % 10, y: i % 7 });
    }
    expectMapInvalid(
      () =>
        sanitizeGameMap({
          ...VALID_MAP,
          rooms: [{ ...VALID_MAP.rooms[0], polygon: bigPolygon }],
        }),
      'room.polygon',
    );
  });
});

describe('validateForSave (minimum viable map)', () => {
  test('requires at least one corridor over two nodes', () => {
    const empty = sanitizeGameMap({ nodes: [], corridors: [] });
    assert.throws(() => validateForSave(empty), GameError);

    const singleNode = sanitizeGameMap({
      nodes: [{ id: 'n1', x: 0, y: 0 }],
      corridors: [],
    });
    assert.throws(() => validateForSave(singleNode), GameError);
  });

  test('a minimal corridor map is saveable', () => {
    const minimal = sanitizeGameMap({
      nodes: [
        { id: 'n1', x: 0, y: 0 },
        { id: 'n2', x: 10, y: 0 },
      ],
      corridors: [{ id: 'c1', a: 'n1', b: 'n2' }],
    });
    assert.equal(validateForSave(minimal), true);
  });
});

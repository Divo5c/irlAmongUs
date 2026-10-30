const { GameError } = require('./errors');
const enumsSchema = require('../../../shared/models/enums.schema.json');

const ROOM_TYPES = enumsSchema.$defs.RoomType.enum;

/** Display names for typed rooms (hosts may only name NORMAL rooms). */
const ROOM_DISPLAY_NAMES = Object.freeze({
  CAFETERIA: 'Cafeteria',
  MEDBAY: 'Medbay',
  SECURITY: 'Security',
  REACTOR: 'Reactor',
  ELECTRICAL: 'Electrical',
  STORAGE: 'Storage',
  ADMIN: 'Admin',
  O2: 'O2',
  WEAPONS: 'Weapons',
});

/** Rooms that sabotage/meeting mechanics need for a playable game. */
const CRITICAL_ROOM_TYPES = Object.freeze(['CAFETERIA', 'REACTOR', 'O2', 'ADMIN']);

/**
 * Hard limits for host-created maps. Generous enough for a whole school
 * floor, small enough to keep payloads and rendering cheap.
 */
const MAP_LIMITS = Object.freeze({
  NODES: 300,
  CORRIDORS: 600,
  ROOMS: 30,
  POLYGON_POINTS: 40,
  COORD_ABS: 50000,
  NAME_LENGTH: 40,
  ID_LENGTH: 24,
});

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkCoord(value, field) {
  if (!isFiniteNumber(value) || Math.abs(value) > MAP_LIMITS.COORD_ABS) {
    throw new GameError(
      'MAP_INVALID',
      `Map value "${field}" must be a finite number within ±${MAP_LIMITS.COORD_ABS}.`,
      { field },
    );
  }
}

function checkId(value, field) {
  if (
    !isNonEmptyString(value) ||
    value.length > MAP_LIMITS.ID_LENGTH ||
    !ID_PATTERN.test(value)
  ) {
    throw new GameError('MAP_INVALID', `Map id "${field}" is invalid.`, {
      field,
    });
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates + normalizes a raw map payload (deep copy out).
 *
 * The server NEVER trusts client map data: structure, ids, references,
 * coordinates, roles and limits are all enforced here. Throws
 * GameError('MAP_INVALID', ..., { field }) on the first violation.
 */
function sanitizeGameMap(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GameError('MAP_INVALID', 'Map must be an object.', {
      field: 'map',
    });
  }

  const nodes = [];
  const nodeIds = new Set();
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (rawNodes.length > MAP_LIMITS.NODES) {
    throw limitError(`At most ${MAP_LIMITS.NODES} nodes are allowed.`);
  }
  for (const node of rawNodes) {
    checkId(node?.id, 'node.id');
    if (nodeIds.has(node.id)) {
      throw duplicateError(`Duplicate node id "${node.id}".`);
    }
    checkCoord(node.x, 'node.x');
    checkCoord(node.y, 'node.y');
    nodeIds.add(node.id);
    nodes.push({ id: node.id, x: node.x, y: node.y });
  }

  const corridors = [];
  const corridorSeen = new Set();
  const rawCorridors = Array.isArray(raw.corridors) ? raw.corridors : [];
  if (rawCorridors.length > MAP_LIMITS.CORRIDORS) {
    throw limitError(`At most ${MAP_LIMITS.CORRIDORS} corridors are allowed.`);
  }
  for (const corridor of rawCorridors) {
    checkId(corridor?.id, 'corridor.id');
    checkId(corridor.a, 'corridor.a');
    checkId(corridor.b, 'corridor.b');
    if (!nodeIds.has(corridor.a) || !nodeIds.has(corridor.b)) {
      throw new GameError(
        'MAP_INVALID',
        `Corridor "${corridor.id}" references unknown nodes.`,
        { field: 'corridors' },
      );
    }
    if (corridor.a === corridor.b) {
      throw new GameError(
        'MAP_INVALID',
        `Corridor "${corridor.id}" connects a node to itself.`,
        { field: 'corridors' },
      );
    }
    const pairKey =
      corridor.a < corridor.b
        ? `${corridor.a}|${corridor.b}`
        : `${corridor.b}|${corridor.a}`;
    if (corridorSeen.has(pairKey)) {
      throw duplicateError(`Duplicate corridor between two nodes.`);
    }
    corridorSeen.add(pairKey);
    corridors.push({ id: corridor.id, a: corridor.a, b: corridor.b });
  }

  const rooms = [];
  const roomIds = new Set();
  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
  if (rawRooms.length > MAP_LIMITS.ROOMS) {
    throw limitError(`At most ${MAP_LIMITS.ROOMS} rooms are allowed.`);
  }
  for (const room of rawRooms) {
    checkId(room?.id, 'room.id');
    if (roomIds.has(room.id)) {
      throw duplicateError(`Duplicate room id "${room.id}".`);
    }
    if (!isNonEmptyString(room.name) || room.name.trim().length > MAP_LIMITS.NAME_LENGTH) {
      throw new GameError(
        'MAP_INVALID',
        `Room name must be 1-${MAP_LIMITS.NAME_LENGTH} characters.`,
        { field: 'room.name' },
      );
    }
    if (!ROOM_TYPES.includes(room.type)) {
      throw new GameError(
        'MAP_INVALID',
        `Room type "${room.type}" is not a valid room role.`,
        { field: 'room.type', allowed: ROOM_TYPES },
      );
    }
    const polygon = Array.isArray(room.polygon) ? room.polygon : [];
    if (polygon.length < 3 || polygon.length > MAP_LIMITS.POLYGON_POINTS) {
      throw new GameError(
        'MAP_INVALID',
        `Room polygon needs 3-${MAP_LIMITS.POLYGON_POINTS} points.`,
        { field: 'room.polygon' },
      );
    }
    const normalizedPolygon = polygon.map((point) => {
      checkCoord(point?.x, 'room.polygon.x');
      checkCoord(point?.y, 'room.polygon.y');
      return { x: point.x, y: point.y };
    });
    roomIds.add(room.id);
    rooms.push({
      id: room.id,
      // Typed rooms ALWAYS carry their canonical name (hosts cannot rename
      // Cafeterias or Reactors into something confusing).
      name: room.type === 'NORMAL' ? room.name.trim() : ROOM_DISPLAY_NAMES[room.type],
      type: room.type,
      polygon: normalizedPolygon,
    });
  }

  const connections = [];
  const connectionSeen = new Set();
  const rawConnections = Array.isArray(raw.connections) ? raw.connections : [];
  if (rawConnections.length > MAP_LIMITS.ROOMS * 4) {
    throw limitError('Too many room connections.');
  }
  for (const connection of rawConnections) {
    if (!roomIds.has(connection?.roomId) || !nodeIds.has(connection?.nodeId)) {
      throw new GameError(
        'MAP_INVALID',
        'Room connection references unknown room or node.',
        { field: 'connections' },
      );
    }
    const key = `${connection.roomId}|${connection.nodeId}`;
    if (connectionSeen.has(key)) {
      continue; // duplicates are silently collapsed
    }
    connectionSeen.add(key);
    connections.push({ roomId: connection.roomId, nodeId: connection.nodeId });
  }

  const width = isFiniteNumber(raw.width) ? raw.width : undefined;
  const height = isFiniteNumber(raw.height) ? raw.height : undefined;

  // GPS anchor of the editor session (needed to project live client GPS
  // fixes into the map's meter space during the game).
  const anchorLat = raw.anchor?.lat;
  const anchorLon = raw.anchor?.lon;
  const anchor =
    isFiniteNumber(anchorLat) &&
    anchorLat >= -90 && anchorLat <= 90 &&
    isFiniteNumber(anchorLon) &&
    anchorLon >= -180 && anchorLon <= 180
      ? { lat: anchorLat, lon: anchorLon }
      : undefined;

  // Two-point calibration (Divo): permanent world anchors. p1/p2 map the
  // map's meter space to real GPS — stored once, reused every game.
  const cal = sanitizeCal(raw.cal);

  return {
    version: 1, // the store assigns the authoritative version on save
    ...(anchor ? { anchor } : {}),
    ...(cal ? { cal } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    nodes,
    corridors,
    rooms,
    connections,
  };

  function limitError(message) {
    return new GameError('MAP_INVALID', message, { field: 'limits' });
  }
  function duplicateError(message) {
    return new GameError('MAP_INVALID', message, { field: 'duplicate' });
  }
}

/**
 * Sanitizes a two-point calibration payload. Returns undefined when the
 * data is missing/invalid (calibration is optional — never blocks a map).
 * p1/p2 must be >= 5m apart (map AND world) so scale stays stable.
 */
function sanitizeCal(raw) {
  const point = (p) => {
    const x = Number(p?.x);
    const y = Number(p?.y);
    const lat = Number(p?.lat);
    const lon = Number(p?.lon);
    if (!Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(lat) || !Number.isFinite(lon)
      || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return null;
    }
    return { x, y, lat, lon };
  };
  const p1 = point(raw?.p1);
  const p2 = point(raw?.p2);
  if (!p1 || !p2) return undefined;
  if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 5) return undefined;
  // World distance (equirectangular rough meters — only used as sanity).
  const m = 111_320;
  const world = Math.hypot(
    (p2.lon - p1.lon) * m * Math.max(0.2, Math.cos((p1.lat * Math.PI) / 180)),
    (p2.lat - p1.lat) * m,
  );
  if (world < 5) return undefined;
  return { p1, p2 };
}

/**
 * Minimum requirements for a SAVED map that allows starting the game:
 * at least one walkable corridor segment exists (>=2 connected nodes).
 * Rooms are optional at this stage.
 */
function validateForSave(map) {
  if (!map || map.nodes.length < 2 || map.corridors.length < 1) {
    throw new GameError(
      'MAP_EMPTY',
      'The map needs at least one corridor with two points before it can be saved.',
      { field: 'map' },
    );
  }
  // Critical rooms: meeting (Cafeteria), sabotage fix/trigger points.
  const types = new Set((map.rooms ?? []).map((room) => room.type));
  const missing = CRITICAL_ROOM_TYPES.filter((type) => !types.has(type));
  if (missing.length) {
    throw new GameError(
      'MAP_CRITICAL_ROOMS_MISSING',
      `The map also needs these rooms: ${missing
        .map((type) => ROOM_DISPLAY_NAMES[type])
        .join(', ')}.`,
      { field: 'rooms', missing },
    );
  }
  return true;
}

module.exports = {
  MAP_LIMITS,
  ROOM_TYPES,
  ROOM_DISPLAY_NAMES,
  CRITICAL_ROOM_TYPES,
  sanitizeGameMap,
  sanitizeCal,
  validateForSave,
};

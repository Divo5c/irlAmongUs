/**
 * Server-side positioning utilities: point-in-polygon, corridor snap,
 * map matching, room membership. All functions are pure (no side effects)
 * and operate on the server's authoritative map model.
 *
 * Coordinate system: 1 world unit ≈ 1 meter. Map bounds ±50000.
 */

const { GameError } = require('./errors');

// Maximum distance (world units) for a point to snap to a corridor segment.
const MAX_SNAP_DISTANCE = 5.0;

// Minimum confidence for a position update to be accepted.
const MIN_CONFIDENCE = 0.0;

// Maximum age (ms) for a position update before it's considered stale.
const MAX_POSITION_AGE_MS = 5000;

// Maximum speed (m/s) between consecutive updates for plausibility.
// A person walking ~5 m/s (sprinting) is the realistic upper bound.
const MAX_SPEED_MPS = 8.0;

/**
 * Ray-casting point-in-polygon test. Returns true if (px, py) is inside
 * the polygon (array of {x, y} vertices, implicitly closed).
 * Handles convex and concave polygons. Points on edges are inside.
 */
function pointInPolygon(px, py, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return false;
  }

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if point is exactly on the edge (within floating-point tolerance)
    const onEdge = isPointOnEdge(px, py, xi, yi, xj, yj);
    if (onEdge) return true;

    // Ray casting: check if ray from (px,py) going +x crosses this edge
    const intersects =
      ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Checks if point (px, py) lies on the line segment from (ax, ay) to (bx, by).
 * Uses cross-product and dot-product checks with a small tolerance.
 */
function isPointOnEdge(px, py, ax, ay, bx, by) {
  // Cross product must be near zero (collinear)
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-6) return false;

  // Dot product to check if within segment bounds
  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= 1e-6;
}

/**
 * Squared distance from point (px, py) to line segment (ax, ay)-(bx, by).
 * Returns { distance, closestX, closestY }.
 */
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a == b)
    const d = Math.hypot(px - ax, py - ay);
    return { distance: d, closestX: ax, closestY: ay };
  }

  // Project point onto the line, clamped to [0, 1]
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  const distance = Math.hypot(px - closestX, py - closestY);

  return { distance, closestX, closestY };
}

/**
 * Snaps a position to the nearest corridor segment in the map.
 * Returns { x, y, distance, corridorId, nodeId } or null if no corridor
 * is within MAX_SNAP_DISTANCE.
 */
function snapToCorridor(px, py, map) {
  if (!map || !map.corridors || !map.nodes) return null;

  const nodeMap = new Map();
  for (const node of map.nodes) {
    nodeMap.set(node.id, node);
  }

  let best = null;
  let bestDist = Infinity;

  for (const corridor of map.corridors) {
    const nodeA = nodeMap.get(corridor.a);
    const nodeB = nodeMap.get(corridor.b);
    if (!nodeA || !nodeB) continue;

    const result = pointToSegmentDistance(
      px, py,
      nodeA.x, nodeA.y,
      nodeB.x, nodeB.y,
    );

    if (result.distance < bestDist) {
      bestDist = result.distance;
      best = {
        x: result.closestX,
        y: result.closestY,
        distance: result.distance,
        corridorId: corridor.id,
        nearestNodeId: bestDist < Math.hypot(result.closestX - nodeA.x, result.closestY - nodeA.y)
          ? corridor.a
          : corridor.b,
      };
    }
  }

  if (best === null || best.distance > MAX_SNAP_DISTANCE) {
    return null;
  }

  return best;
}

/**
 * Resolves which room a position falls in, or if it's on a corridor.
 *
 * @returns {{ roomId: string|null, onCorridor: boolean, snappedX: number, snappedY: number }}
 */
function resolveRoomMembership(px, py, map) {
  if (!map) {
    return { roomId: null, onCorridor: false, snappedX: px, snappedY: py };
  }

  // First: check all room polygons
  if (map.rooms) {
    for (const room of map.rooms) {
      if (pointInPolygon(px, py, room.polygon)) {
        return {
          roomId: room.id,
          onCorridor: false,
          snappedX: px,
          snappedY: py,
        };
      }
    }
  }

  // Second: try snapping to a corridor
  const snap = snapToCorridor(px, py, map);
  if (snap) {
    return {
      roomId: null,
      onCorridor: true,
      snappedX: snap.x,
      snappedY: snap.y,
    };
  }

  // Outside all rooms and too far from corridors
  return { roomId: null, onCorridor: false, snappedX: px, snappedY: py };
}

/**
 * Validates and sanitizes a raw position estimate from a client.
 * Server overrides timestamp with its own clock for consistency.
 *
 * @returns {{ x, y, heading, confidence, source, timestamp }}
 */
function sanitizePositionEstimate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new GameError('POSITION_INVALID', 'Position must be an object.');
  }

  const x = Number(raw.x);
  const y = Number(raw.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GameError('POSITION_INVALID', 'Position x and y must be finite numbers.');
  }

  if (Math.abs(x) > 50000 || Math.abs(y) > 50000) {
    throw new GameError('POSITION_OUT_OF_BOUNDS', 'Position is outside map bounds (±50000).');
  }

  let heading = raw.heading === null || raw.heading === undefined
    ? null
    : Number(raw.heading);

  if (heading !== null && (!Number.isFinite(heading) || heading < 0 || heading >= 360)) {
    heading = null;
  }

  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0) {
    confidence = 0.5;
  }
  confidence = Math.min(1, Math.max(0, confidence));

  const validSources = ['IMU', 'GPS', 'BLE', 'WIFI', 'UWB', 'AR', 'FUSED', 'MANUAL_DEBUG'];
  const source = validSources.includes(raw.source) ? raw.source : 'FUSED';

  // Server overrides the client timestamp to prevent clock manipulation
  const timestamp = Date.now();

  return { x, y, heading, confidence, source, timestamp };
}

/**
 * Computes the Euclidean distance between two {x, y} positions.
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Checks if a position update is temporally and spatially plausible
 * given the previous position.
 *
 * @param {{ x, y, timestamp }} current
 * @param {{ x, y, timestamp }|null} previous
 * @returns {{ valid: boolean, reason?: string }}
 */
function isPositionPlausible(current, previous) {
  if (!previous) return { valid: true };

  const dtMs = current.timestamp - previous.timestamp;
  if (dtMs < 0) {
    return { valid: false, reason: 'POSITION_CLOCK_JUMP' };
  }

  if (dtMs > MAX_POSITION_AGE_MS * 3) {
    // Very long gap — accept but flag as re-entry
    return { valid: true };
  }

  if (dtMs > 0) {
    const dist = distance(current, previous);
    const speed = dist / (dtMs / 1000);
    if (speed > MAX_SPEED_MPS) {
      return {
        valid: false,
        reason: 'POSITION_UNREALISTIC',
        details: { speed, maxSpeed: MAX_SPEED_MPS },
      };
    }
  }

  return { valid: true };
}

module.exports = {
  pointInPolygon,
  isPointOnEdge,
  pointToSegmentDistance,
  snapToCorridor,
  resolveRoomMembership,
  sanitizePositionEstimate,
  distance,
  isPositionPlausible,
  MAX_SNAP_DISTANCE,
  MAX_POSITION_AGE_MS,
  MAX_SPEED_MPS,
  MIN_CONFIDENCE,
};

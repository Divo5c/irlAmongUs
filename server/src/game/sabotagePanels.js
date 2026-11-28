const { createHash, randomInt, randomUUID } = require('node:crypto');
const { pointInPolygon, pointToSegmentDistance } = require('./positioning');

const PANEL_USE_RADIUS_M = 3;
const REACTOR_PANEL_MIN_SEPARATION_M = 10;
const REACTOR_PANEL_MAX_OFF_ROAD_M = 2;
const REACTOR_ROAD_SAMPLE_STEP_M = 0.5;
const OXYGEN_PANEL_MIN_SEPARATION_M = 10;
const REACTOR_HOLD_MS = 1500;
const REACTOR_RELEASE_GRACE_MS = 300;
const REACTOR_HEARTBEAT_TIMEOUT_MS = 1500;
const O2_RETRY_MS = 1000;
const PANEL_EDGE_MARGIN_M = 0.5;
const GRID = [0.5, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20).filter((value) => value !== 0.5)];
const layouts = new WeakMap();
const previousOxygenCodes = new WeakMap();

function roomCandidates(room, roads = []) {
  const polygon = room?.polygon;
  if (!polygon?.length) return [];
  const xs = polygon.map(({ x }) => x);
  const ys = polygon.map(({ y }) => y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const points = [];
  const inside = (x, y) => pointInPolygon(x, y, polygon) && polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) >= PANEL_EDGE_MARGIN_M;
  });
  const add = (x, y) => points.push({ x, y, roomId: room.id, roomType: room.type });
  const nearbyRoads = roads.map(([a, b]) => clipRoad(a, b, left, top, width, height)).filter(Boolean);
  if (roads.length && !nearbyRoads.length) return [];
  // Grid candidates also cover usable ground alongside the road.
  for (const u of GRID) {
    for (const v of GRID) {
      const x = left + u * width, y = top + v * height;
      if (inside(x, y) && (!roads.length || nearbyRoads.some(([a, b]) =>
        pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y).distance <= REACTOR_PANEL_MAX_OFF_ROAD_M))) add(x, y);
    }
  }
  // Sample the actual road too, so a narrow strip can fall between grid rows.
  for (const [a, b] of nearbyRoads) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const count = Math.max(1, Math.min(128, Math.ceil(Math.hypot(dx, dy) / REACTOR_ROAD_SAMPLE_STEP_M)));
    for (let i = 0; i <= count; i += 1) {
      const x = a.x + dx * i / count, y = a.y + dy * i / count;
      if (inside(x, y)) add(x, y);
    }
  }
  return points;
}

function clipRoad(a, b, left, top, width, height) {
  const margin = REACTOR_PANEL_MAX_OFF_ROAD_M;
  let start = 0, end = 1;
  for (const [axis, min, max] of [['x', left - margin, left + width + margin],
    ['y', top - margin, top + height + margin]]) {
    const delta = b[axis] - a[axis];
    if (!delta) {
      if (a[axis] < min || a[axis] > max) return null;
      continue;
    }
    const lo = (min - a[axis]) / delta, hi = (max - a[axis]) / delta;
    start = Math.max(start, Math.min(lo, hi));
    end = Math.min(end, Math.max(lo, hi));
    if (start > end) return null;
  }
  return [start, end].map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
}

function farthestReactorPair(points) {
  if (points.length < 2) return [];
  // The farthest pair lies on the convex hull. Sort first for deterministic ties.
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  function halfHull(ordered) {
    const half = [];
    for (const point of ordered) {
      if (half.at(-1)?.x === point.x && half.at(-1)?.y === point.y) continue;
      while (half.length >= 2) {
        const a = half.at(-2), b = half.at(-1);
        if ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) > 0) break;
        half.pop();
      }
      half.push(point);
    }
    return half.slice(0, -1);
  }
  const hull = [...halfHull(sorted), ...halfHull(sorted.reverse())];
  let pair = [], best = 0;
  for (let i = 0; i < hull.length; i += 1) {
    for (let j = i + 1; j < hull.length; j += 1) {
      const distance = Math.hypot(hull[i].x - hull[j].x, hull[i].y - hull[j].y);
      if (distance >= REACTOR_PANEL_MIN_SEPARATION_M && distance > best) {
        best = distance;
        pair = [hull[i], hull[j]];
      }
    }
  }
  return pair;
}

function reactorPanelPair(reactor, roads) {
  if (roads.length) return farthestReactorPair(reactor);
  for (const left of reactor) {
    const right = reactor.find((spot) => {
      const distance = Math.hypot(spot.x - left.x, spot.y - left.y);
      return distance >= REACTOR_PANEL_MIN_SEPARATION_M && distance <= REACTOR_PANEL_MIN_SEPARATION_M + 1;
    }) ?? reactor.find((spot) => Math.hypot(spot.x - left.x, spot.y - left.y) >= REACTOR_PANEL_MIN_SEPARATION_M);
    if (right) return [left, right];
  }
  return [];
}

function panelLayout(map) {
  if (!map) return { REACTOR: [], O2: [] };
  if (layouts.has(map)) return layouts.get(map);
  const candidates = (type, roads) => roomCandidates(map.rooms?.find((room) => room.type === type), roads);
  const nodes = new Map(map.nodes?.map((node) => [node.id, node]));
  const roads = (map.corridors ?? []).map(({ a, b }) => [nodes.get(a), nodes.get(b)])
    .filter(([a, b]) => a && b && (a.x !== b.x || a.y !== b.y));
  const pair = reactorPanelPair(candidates('REACTOR', roads), roads)
    .map((spot, index) => ({ ...spot, id: `reactor-${index + 1}` }));
  const adminCandidates = candidates('ADMIN');
  let oxygenPair = [];
  for (const oxygen of candidates('O2')) {
    const admin = adminCandidates.find((spot) =>
      Math.hypot(spot.x - oxygen.x, spot.y - oxygen.y) >= OXYGEN_PANEL_MIN_SEPARATION_M);
    if (admin) {
      oxygenPair = [{ ...oxygen, id: 'o2' }, { ...admin, id: 'admin' }];
      break;
    }
  }
  const layout = {
    REACTOR: pair,
    O2: oxygenPair,
    ...(pair.length ? {} : { reactorPlacementIssue: roads.length ? 'NO_WALKABLE_PAIR' : 'ROOM_TOO_SMALL' }),
  };
  layouts.set(map, layout);
  return layout;
}

function makePanels(room, type, spots) {
  let code = null;
  if (type === 'O2') {
    let digest;
    do {
      code = String(randomInt(10000, 100000));
      digest = createHash('sha256').update(code).digest('hex');
    } while (digest === previousOxygenCodes.get(room));
    previousOxygenCodes.set(room, digest);
  }
  return {
    id: randomUUID(),
    spots,
    code,
    open: new Map(),
    holds: new Map(),
    retry: new Map(),
    togetherSince: null,
  };
}

module.exports = {
  PANEL_USE_RADIUS_M, REACTOR_PANEL_MIN_SEPARATION_M, REACTOR_HOLD_MS,
  REACTOR_RELEASE_GRACE_MS, REACTOR_HEARTBEAT_TIMEOUT_MS, O2_RETRY_MS,
  panelLayout, makePanels,
};

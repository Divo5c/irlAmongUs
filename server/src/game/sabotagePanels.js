const { createHash, randomInt, randomUUID } = require('node:crypto');
const { pointInPolygon } = require('./positioning');

const PANEL_USE_RADIUS_M = 3;
const REACTOR_PANEL_MIN_SEPARATION_M = 10;
const OXYGEN_PANEL_MIN_SEPARATION_M = 10;
const REACTOR_HOLD_MS = 1500;
const REACTOR_RELEASE_GRACE_MS = 300;
const REACTOR_HEARTBEAT_TIMEOUT_MS = 1500;
const O2_RETRY_MS = 1000;
const PANEL_EDGE_MARGIN_M = 0.5;
const GRID = [0.5, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20).filter((value) => value !== 0.5)];
const layouts = new WeakMap();
const previousOxygenCodes = new WeakMap();

function roomCandidates(room) {
  const polygon = room?.polygon;
  if (!polygon?.length) return [];
  const xs = polygon.map(({ x }) => x);
  const ys = polygon.map(({ y }) => y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const points = [];
  // Prefer the centre, then search a bounded grid for concave rooms.
  for (const u of GRID) {
    for (const v of GRID) {
      const x = left + u * width, y = top + v * height;
      if (!pointInPolygon(x, y, polygon)) continue;
      const awayFromEdge = polygon.every((a, index) => {
        const b = polygon[(index + 1) % polygon.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - a.x - t * dx, y - a.y - t * dy) >= PANEL_EDGE_MARGIN_M;
      });
      if (awayFromEdge) points.push({ x, y, roomId: room.id, roomType: room.type });
    }
  }
  return points;
}

function panelLayout(map) {
  if (!map) return { REACTOR: [], O2: [] };
  if (layouts.has(map)) return layouts.get(map);
  const candidates = (type) => roomCandidates(map.rooms?.find((room) => room.type === type));
  const reactor = candidates('REACTOR');
  let pair = [];
  for (const left of reactor) {
    const right = reactor.find((spot) => {
      const distance = Math.hypot(spot.x - left.x, spot.y - left.y);
      return distance >= REACTOR_PANEL_MIN_SEPARATION_M && distance <= REACTOR_PANEL_MIN_SEPARATION_M + 1;
    }) ?? reactor.find((spot) => Math.hypot(spot.x - left.x, spot.y - left.y) >= REACTOR_PANEL_MIN_SEPARATION_M);
    if (right) {
      pair = [{ ...left, id: 'reactor-1' }, { ...right, id: 'reactor-2' }];
      break;
    }
  }
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

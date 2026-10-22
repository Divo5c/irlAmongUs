/**
 * OpenStreetMap street loading for the browser PWA.
 *
 * Ports the Dart core (gps_projector.dart / osm_streets.dart /
 * trace_to_map.dart) to plain JS, no build step:
 *  - metric equirectangular projection around an anchor fix (north = -y)
 *  - Overpass QL query (POST form body, mirrors for HTTP 502)
 *  - map building from street polylines (simplify + node merging)
 */
'use strict';

const OSM = (() => {
  const EARTH_RADIUS_M = 6371000;

  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  /** Metric equirectangular projection centered on the anchor fix. */
  function createProjector(lat, lon) {
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    return {
      project(lat_, lon_) {
        const x = EARTH_RADIUS_M * ((lon_ - lon) * Math.PI) / 180 * cosLat;
        const y = -EARTH_RADIUS_M * ((lat_ - lat) * Math.PI) / 180;
        return [x, y];
      },
      anchor: { lat, lon },
    };
  }

  function buildOverpassQuery(lat, lon, radiusM) {
    const radius = Math.round(radiusM);
    return (
      `[out:json][timeout:20];way(around:${radius},${lat.toFixed(6)},` +
      `${lon.toFixed(6)})["highway"];out geom 1500;`
    );
  }

  /** POST query directly from the browser; main endpoint first, then mirrors. */
  async function fetchOverpass(query, timeoutMs = 40000) {
    let lastError = null;
    for (const endpoint of ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) {
          lastError = `Overpass-Server \u00fcberlastet (HTTP ${response.status})`;
          continue;
        }
        const data = JSON.parse(body);
        const out = [];
        for (const element of data.elements ?? []) {
          if (element.type !== 'way') continue;
          const geom = (element.geometry ?? []).filter(Boolean);
          if (geom.length < 2) continue;
          out.push({
            osmId: element.id,
            name:
              (element.tags && (element.tags.name || element.tags.ref)) ??
              element.id,
            points: geom.map((p) => [p.lat, p.lon]),
          });
        }
        return out;
      } catch (error) {
        lastError =
          error.name === 'AbortError'
            ? 'Overpass-Antwort dauerte zu lange \u2014 nochmal versuchen.'
            : `Netzwerkfehler: ${error.message}`;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(lastError ?? 'Overpass nicht erreichbar.');
  }

  /** Fetch streets around a position, returns [{osmId,name,points}]. */
  async function fetchStreets(lat, lon, radiusM) {
    return fetchOverpass(buildOverpassQuery(lat, lon, radiusM));
  }

  /** Projects streets to meter space around the anchor. */
  function toCandidates(streets, anchor) {
    const projector = createProjector(anchor.lat, anchor.lon);
    return streets.map((street) => ({
      id: street.osmId,
      name: String(street.name),
      points: street.points.map(([lat, lon]) => projector.project(lat, lon)),
    }));
  }

  /**
   * Splits OSM candidate polylines into selectable pieces at real junctions
   * (proper crossings with other candidates and T-ends of other candidates
   * landing on the polyline). Pieces are plain candidates again, so the
   * editor taps/selects single blocks instead of whole long OSM ways.
   */
  function splitCandidatesAtJunctions(candidates, options = {}) {
    const epsilon = options.epsilon ?? 1.2;
    const snapDistM = options.snapDistM ?? 1.0;

    const chains = [];
    for (const candidate of candidates) {
      const pts = (candidate.points ?? []).filter(
        ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
      );
      if (pts.length < 2) continue;
      const simplified = simplifyPolyline(pts, epsilon);
      if (simplified.length < 2) continue;
      chains.push({ source: candidate, pts: simplified });
    }

    let pieceSeq = 0;
    const pieces = [];
    for (const chain of chains) {
      const cuts = collectCuts(chain, chains);
      for (const piece of sliceIntoPieces(chain, cuts)) pieces.push(piece);
    }
    return pieces;

    function collectCuts(chain, all) {
      const cuts = [];
      for (const other of all) {
        if (other === chain) continue;
        collectChainCuts(chain, other, cuts);
      }
      cuts.sort((p, q) => p.seg - q.seg || p.t - q.t);
      const deduped = [];
      for (const cut of cuts) {
        const last = deduped[deduped.length - 1];
        if (
          last &&
          last.seg === cut.seg &&
          Math.hypot(last.x - cut.x, last.y - cut.y) < 0.5
        ) {
          continue;
        }
        deduped.push(cut);
      }
      return deduped;
    }

    function collectChainCuts(chain, other, cuts) {
      const A = chain.pts;
      const B = other.pts;
      for (let i = 0; i < A.length - 1; i++) {
        const [ax, ay] = A[i];
        const [bx, by] = A[i + 1];
        for (let j = 0; j < B.length - 1; j++) {
          const [cx, cy] = B[j];
          const [dx, dy] = B[j + 1];
          if (shareEndpoint(ax, ay, bx, by, cx, cy, dx, dy)) continue;
          const rX = bx - ax;
          const rY = by - ay;
          const sX = dx - cx;
          const sY = dy - cy;
          const denom = rX * sY - rY * sX;
          if (Math.abs(denom) < 1e-9) continue;
          const t = ((cx - ax) * sY - (cy - ay) * sX) / denom;
          const u = ((cx - ax) * rY - (cy - ay) * rX) / denom;
          const segEps = 0.002;
          if (t <= segEps || t >= 1 - segEps || u <= segEps || u >= 1 - segEps) {
            continue;
          }
          cuts.push({ seg: i, t, x: ax + t * rX, y: ay + t * rY });
        }
        // Other's endpoint lands on my segment interior: cut me there so
        // the T-street visibly terminates on my pieces.
        for (const [ex, ey] of [B[0], B[B.length - 1]]) {
          const rX = bx - ax;
          const rY = by - ay;
          const len2 = rX * rX + rY * rY || 1e-9;
          const t = ((ex - ax) * rX + (ey - ay) * rY) / len2;
          if (t <= 0.02 || t >= 0.98) continue;
          const px = ax + t * rX;
          const py = ay + t * rY;
          if (Math.hypot(ex - px, ey - py) > snapDistM) continue;
          if (Math.hypot(ex - ax, ey - ay) < 0.8) continue;
          if (Math.hypot(ex - bx, ey - by) < 0.8) continue;
          cuts.push({ seg: i, t, x: ex, y: ey });
        }
      }
    }

    function shareEndpoint(ax, ay, bx, by, cx, cy, dx, dy) {
      const tol = 0.05;
      return (
        (Math.hypot(ax - cx, ay - cy) < tol ||
          Math.hypot(ax - dx, ay - dy) < tol ||
          Math.hypot(bx - cx, by - cy) < tol ||
          Math.hypot(bx - dx, by - dy) < tol)
      );
    }

    function sliceIntoPieces(chain, cuts) {
      const out = [];
      let cur = [chain.pts[0]];
      for (let i = 0; i < chain.pts.length - 1; i++) {
        const [ax, ay] = chain.pts[i];
        const [bx, by] = chain.pts[i + 1];
        for (const cut of cuts) {
          if (cut.seg !== i) continue;
          cur.push([cut.x, cut.y]);
          out.push(makePiece(cur, chain));
          cur = [[cut.x, cut.y]];
        }
        cur.push([bx, by]);
      }
      out.push(makePiece(cur, chain));
      return out;
    }

    function makePiece(pts, chain) {
      if (pts.length < 2) return null;
      pieceSeq++;
      return {
        id: `${chain.source.id}~${pieceSeq}`,
        name: chain.source.name,
        osmId: chain.source.osmId,
        points: pts,
        parent: chain.source.id,
      };
    }
  }

  /**
   * Ramer-Douglas-Peucker simplification (epsilon in meters, like the
   * mobile app's buildMapFromTrace).
   */
  function simplifyPolyline(points, epsilon) {
    if (points.length < 3) return points.slice();
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop();
      if (end - start < 2) continue;
      const [ax, ay] = points[start];
      const [bx, by] = points[end];
      const dirX = bx - ax;
      const dirY = by - ay;
      const len = Math.hypot(dirX, dirY) || 1e-9;
      let maxDist = -1;
      let maxIdx = -1;
      for (let i = start + 1; i < end; i++) {
        const [px, py] = points[i];
        // Perpendicular distance to the segment line.
        const t = ((px - ax) * dirX + (py - ay) * dirY) / (len * len);
        const cx = ax + t * dirX;
        const cy = ay + t * dirY;
        const dist = Math.hypot(px - cx, py - cy);
        if (dist > maxDist) {
          maxDist = dist;
          maxIdx = i;
        }
      }
      if (maxDist > epsilon) {
        keep[maxIdx] = true;
        stack.push([start, maxIdx], [maxIdx, end]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  /**
   * Merges selected street candidates into the working map
   * ({nodes:[{id,x,y}], corridors:[{id,a,b}], ...}). Node ids continue the
   * numeric sequence found in the base map; nodes within `mergeRadiusM`
   * collapse into one so street joints connect corridors.
   */
  function buildMapFromCandidates(candidates, base, options = {}) {
    const mergeRadiusM = options.mergeRadiusM ?? 1.5;
    const minSegmentLength = options.minSegmentLength ?? 0.5;
    const epsilon = options.epsilon ?? 1.2;

    let seq = 0;
    for (const { id } of base.nodes) {
      const suffix = Number(String(id).replace(/^n/, ''));
      if (Number.isFinite(suffix) && suffix > seq) seq = suffix;
    }

    const outNodes = base.nodes.slice();
    const outCorridors = base.corridors.slice();
    const existingPairs = new Set(
      outCorridors.map(({ a, b }) => (a < b ? `${a}|${b}` : `${b}|${a}`)),
    );

    const findOrAddNode = (x, y) => {
      let best = null;
      let bestDist = Infinity;
      for (const node of outNodes) {
        const dist = Math.hypot(node.x - x, node.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (best && bestDist <= mergeRadiusM) return best;
      seq++;
      const node = { id: `n${seq}`, x, y };
      outNodes.push(node);
      return node;
    };

    for (const candidate of candidates) {
      const streetPoints = candidate.points.filter(
        ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
      );
      if (streetPoints.length < 2) continue;
      const simplified = simplifyPolyline(streetPoints, epsilon);
      if (simplified.length < 2) continue;
      for (let i = 0; i < simplified.length - 1; i++) {
        const a = findOrAddNode(...simplified[i]);
        const b = findOrAddNode(...simplified[i + 1]);
        if (a.id === b.id) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < minSegmentLength) continue;
        const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (existingPairs.has(pairKey)) continue;
        existingPairs.add(pairKey);
        outCorridors.push({ id: `c${seq}_${i}_${a.id}_${b.id}`, a: a.id, b: b.id });
      }
    }

    // Junction passes: split streets where they properly cross another
    // selected street, and glue T-endpoints onto the street they touch.
    // Same rule as the Flutter trace pipeline, so the game graph branches
    // like the real street network instead of running over intersections.
    let pieceId = 0;

    function pieceCorridorId(from, to) {
      pieceId++;
      return `s${pieceId}_${from}_${to}`;
    }

    function nodeOfCache() {
      const map = new Map();
      for (const node of outNodes) map.set(node.id, node);
      return map;
    }

    splitAtProperIntersections();
    snapLooseEndpoints();

    return {
      version: (base.version ?? 0) + 1,
      nodes: outNodes,
      corridors: outCorridors,
    };

    /** Strict crossing of two segment-corridors that share no endpoint. */
    function segmentCross(A, B, lookup) {
      // A corridor is always a single segment (a -> b).
      const a = lookup.get(A.a);
      const b = lookup.get(A.b);
      const c = lookup.get(B.a);
      const d = lookup.get(B.b);
      if (!a || !b || !c || !d) return null;
      // Already joined anywhere: the graph is connected there.
      if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) return null;
      const rX = b.x - a.x;
      const rY = b.y - a.y;
      const sX = d.x - c.x;
      const sY = d.y - c.y;
      const denom = rX * sY - rY * sX;
      if (Math.abs(denom) < 1e-9) return null;
      const t = ((c.x - a.x) * sY - (c.y - a.y) * sX) / denom;
      const u = ((c.x - a.x) * rY - (c.y - a.y) * rX) / denom;
      const eps = 0.002;
      if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
      return [a.x + t * rX, a.y + t * rY];
    }

    /** Replaces a corridor with two pieces through the junction point. */
    function splitCorridorAt(corridor, x, y) {
      const a = outNodes.find((n) => n.id === corridor.a);
      const b = outNodes.find((n) => n.id === corridor.b);
      if (!a || !b) return false;
      const rX = b.x - a.x;
      const rY = b.y - a.y;
      const denom = rX * rX + rY * rY || 1e-9;
      let t = ((x - a.x) * rX + (y - a.y) * rY) / denom;
      t = Math.max(0, Math.min(1, t));
      // Reject splits that are not (almost) exactly on the segment.
      if (Math.hypot(a.x + t * rX - x, a.y + t * rY - y) > 2) return false;
      const junction = findOrAddNode(x, y);
      const drop = outCorridors.indexOf(corridor);
      if (drop < 0) return false;
      outCorridors.splice(drop, 1);
      for (const [from, to] of [
        [corridor.a, junction.id],
        [junction.id, corridor.b],
      ]) {
        const pairKey = from < to ? `${from}|${to}` : `${to}|${from}`;
        if (existingPairs.has(pairKey)) continue;
        existingPairs.add(pairKey);
        outCorridors.push({ id: pieceCorridorId(from, to), a: from, b: to });
      }
      return true;
    }

    function splitAtProperIntersections() {
      const maxSplits = 400;
      let splits = 0;
      let pass = 0;
      let changed = true;
      while (changed && splits < maxSplits && pass < 80) {
        pass++;
        changed = false;
        const lookup = nodeOfCache();
        outer: for (let i = 0; i < outCorridors.length; i++) {
          for (let j = i + 1; j < outCorridors.length; j++) {
            const cross = segmentCross(outCorridors[i], outCorridors[j], lookup);
            if (!cross) continue;
            splitCorridorAt(outCorridors[i], cross[0], cross[1]);
            splitCorridorAt(outCorridors[j], cross[0], cross[1]);
            splits++;
            changed = true;
            break outer;
          }
        }
      }
    }

    /** Glues a street endpoint that lies on top of another street there. */
    function snapLooseEndpoints() {
      const maxSnaps = 300;
      let snaps = 0;
      const snapshot = outCorridors.slice();
      for (const corridor of snapshot) {
        if (snaps >= maxSnaps) break;
        if (!outCorridors.includes(corridor)) continue;
        for (const endpoint of [corridor.a, corridor.b]) {
          const node = outNodes.find((n) => n.id === endpoint);
          if (!node) continue;
          const target = outCorridors.find((other) => {
            if (other === corridor) return false;
            if (other.a === node.id || other.b === node.id) return false;
            const a = outNodes.find((n) => n.id === other.a);
            const b = outNodes.find((n) => n.id === other.b);
            if (!a || !b) return false;
            // Too close to the target's own ends: useless split.
            const dEnd = Math.min(
              Math.hypot(a.x - node.x, a.y - node.y),
              Math.hypot(b.x - node.x, b.y - node.y),
            );
            if (dEnd < 0.8) return false;
            return pointSegmentDistance(node.x, node.y, a.x, a.y, b.x, b.y) <= 1.0;
          });
          if (!target) continue;
          const junction = findOrAddNode(node.x, node.y);
          if (junction.id !== node.id) {
            if (corridor.a === node.id) corridor.a = junction.id;
            else corridor.b = junction.id;
          }
          splitCorridorAt(target, node.x, node.y);
          snaps++;
          if (snaps >= maxSnaps) break;
        }
      }
    }

    function pointSegmentDistance(px, py, ax, ay, bx, by) {
      const rX = bx - ax;
      const rY = by - ay;
      const len2 = rX * rX + rY * rY || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - ax) * rX + (py - ay) * rY) / len2));
      return Math.hypot(ax + t * rX - px, ay + t * rY - py);
    }
  }

  return {
    createProjector,
    buildOverpassQuery,
    fetchStreets,
    toCandidates,
    splitCandidatesAtJunctions,
    buildMapFromCandidates,
    simplifyPolyline,
  };
})();

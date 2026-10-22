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
      `${lon.toFixed(6)})["highway"];out geom;`
    );
  }

  /** POST query; tries main endpoint first, then the kumi mirror. */
  async function fetchOverpass(query, timeoutMs = 25000) {
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
          lastError = `Overpass-Antwort: HTTP ${response.status}${
            body.includes('capacity') || body.includes('Timeout')
              ? ' (Server voll, versuche es gleich erneut)'
              : ''
          }`;
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
            ? 'Overpass-Antwort dauert zu lange — nochmal versuchen.'
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

    return {
      version: (base.version ?? 0) + 1,
      nodes: outNodes,
      corridors: outCorridors,
    };
  }

  return {
    createProjector,
    buildOverpassQuery,
    fetchStreets,
    toCandidates,
    buildMapFromCandidates,
    simplifyPolyline,
  };
})();

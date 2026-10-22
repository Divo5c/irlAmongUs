const { HttpError } = require('../utils/http');

/**
 * OSM street data proxy for the PWA map editor.
 *
 * The browser cannot reliably query Overpass directly (CORS quirks, shared
 * rate limits, hop-by-hop failures), so the PWA calls this endpoint and the
 * server performs the Overpass requests itself (POST, custom User-Agent,
 * mirror fallback) and returns a compact clean list of streets.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const QUERY_TIMEOUT_MS = 45_000;

function parseStrictNumber(value, field, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `Query parameter "${field}" must be a number.`);
  }
  if (parsed < min || parsed > max) {
    throw new HttpError(400, `Query parameter "${field}" must be between ${min} and ${max}.`);
  }
  return parsed;
}

function buildOverpassQuery(lat, lon, radiusM) {
  // Cap output elements so the reply stays renderable (nodes stay fast).
  return (
    `[out:json][timeout:20];way(around:${Math.round(radiusM)},` +
    `${lat.toFixed(6)},${lon.toFixed(6)})["highway"];out geom 1500;`
  );
}

function parseStreets(payload) {
  const streets = [];
  for (const element of payload?.elements ?? []) {
    if (element.type !== 'way') continue;
    const geometry = (element.geometry ?? []).filter(Boolean);
    if (geometry.length < 2) continue;
    streets.push({
      osmId: element.id,
      name: String(element.tags?.name ?? element.tags?.ref ?? element.id),
      points: geometry.map((point) => [point.lat, point.lon]),
    });
  }
  return streets;
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RealLifeAmongUs/0.1 (PWA proxy; render.com service)',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        lastError =
          response.status === 502 || response.status === 504 || response.status === 429
            ? `Overpass-Server gerade \u00fcberlastet (HTTP ${response.status}).`
            : `Overpass-Fehler (HTTP ${response.status}).`;
        continue;
      }
      return parseStreets(JSON.parse(body));
    } catch (error) {
      lastError =
        error.name === 'AbortError'
          ? 'Overpass-Antwort dauerte zu lange.'
          : 'Overpass war nicht erreichbar.';
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpError(502, lastError ?? 'Overpass nicht erreichbar.');
}

async function getStreets(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const lat = parseStrictNumber(url.searchParams.get('lat'), 'lat', { min: -85, max: 85 });
  const lon = parseStrictNumber(url.searchParams.get('lon'), 'lon', { min: -180, max: 180 });
  const radius = parseStrictNumber(url.searchParams.get('radius') ?? 300, 'radius', {
    min: 50,
    max: 5000,
  });
  const streets = await fetchOverpass(buildOverpassQuery(lat, lon, radius));
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  response.end(JSON.stringify({ lat, lon, radius, streets }));
}

module.exports = { getStreets };

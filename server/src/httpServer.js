const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const {
  HttpError,
  createRoom,
  getRoom,
  joinRoom,
} = require('./api/roomsController');
const { getStreets } = require('./api/osmStreetsController');
const { sendJson } = require('./utils/http');

/** Static assets for the PWA are served from public/ (same origin, no CORS). */
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
};

function serveStaticFile(response, relativePath) {
  const resolved = path.normalize(path.join(PUBLIC_DIR, relativePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(response, 404, { error: 'Route not found.' });
    return;
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: 'Route not found.' });
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    // Immutable shell assets; index/sw/js/css stay fresh so deploys land fast.
    const alwaysFresh =
      ext === '.html' ||
      resolved.endsWith('.webmanifest') ||
      resolved.endsWith('sw.js') ||
      ext === '.js' ||
      ext === '.css';
    const cache = alwaysFresh ? 'no-cache' : 'public, max-age=300';
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': cache,
      'Service-Worker-Allowed': '/',
    });
    response.end(data);
  });
}

function createHttpServer(roomStore) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      // PWA shell: "/" plus every static asset inside public/.
      if (request.method === 'GET') {
        if (url.pathname === '/') {
          serveStaticFile(response, 'index.html');
          return;
        }
        if (url.pathname === '/manifest.webmanifest' || url.pathname === '/sw.js') {
          serveStaticFile(response, url.pathname.slice(1));
          return;
        }
        const asset = path.normalize(url.pathname).replace(/^([/\\])+/, '');
        if (asset.startsWith('css/') || asset.startsWith('js/') || asset.startsWith('icons/')
          || asset.startsWith('sfx/') || asset.startsWith('img/')) {
          serveStaticFile(response, asset);
          return;
        }
      }

      const roomMatch = url.pathname.match(/^\/rooms\/([A-Z2-9]+)$/);
      const joinRoomMatch = url.pathname.match(/^\/rooms\/([A-Z2-9]+)\/join$/);

      // OSM street proxy for the PWA map editor.
      if (url.pathname === '/osm/streets' && request.method === 'GET') {
        await getStreets(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/rooms') {
        await createRoom(request, response, roomStore);
        return;
      }

      if (roomMatch && request.method === 'GET') {
        getRoom(request, response, roomStore, roomMatch[1]);
        return;
      }

      if (joinRoomMatch && request.method === 'POST') {
        await joinRoom(request, response, roomStore, joinRoomMatch[1]);
        return;
      }

      sendJson(response, 404, { error: 'Route not found.' });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      console.error('Unhandled HTTP request failure:', error.message);
      sendJson(response, 500, { error: 'Internal server error.' });
    }
  });
}

module.exports = { createHttpServer };

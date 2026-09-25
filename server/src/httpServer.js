const http = require('node:http');

const {
  HttpError,
  createRoom,
  getRoom,
  joinRoom,
} = require('./api/roomsController');
const { sendJson } = require('./utils/http');

function createHttpServer(roomStore) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      const roomMatch = url.pathname.match(/^\/rooms\/([A-Z2-9]+)$/);
      const joinRoomMatch = url.pathname.match(/^\/rooms\/([A-Z2-9]+)\/join$/);

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

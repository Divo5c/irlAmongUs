const { HttpError, readJsonBody, sendJson } = require('../utils/http');
const { RoomStoreError } = require('../rooms/roomStore');

async function createRoom(request, response, roomStore) {
  const body = await readJsonBody(request);

  try {
    const room = roomStore.createRoom(body);
    sendJson(response, 201, roomStore.toPublicRoom(room));
  } catch (error) {
    sendRoomStoreError(response, error);
  }
}

function getRoom(_request, response, roomStore, code) {
  const room = roomStore.getRoom(code);

  if (!room) {
    sendJson(response, 404, { error: 'Room not found.' });
    return;
  }

  // Public projection only: never expose player roles over HTTP.
  sendJson(response, 200, roomStore.toPublicRoom(room));
}

async function joinRoom(request, response, roomStore, code) {
  const player = await readJsonBody(request);

  try {
    const room = roomStore.addPlayerToRoom(code, player);
    sendJson(response, 200, roomStore.toPublicRoom(room));
  } catch (error) {
    sendRoomStoreError(response, error);
  }
}

function sendRoomStoreError(response, error) {
  if (!(error instanceof RoomStoreError)) {
    throw error;
  }

  const statusCode = error.code === 'ROOM_NOT_FOUND' ? 404 : 400;
  sendJson(response, statusCode, { error: error.message });
}

module.exports = { HttpError, createRoom, getRoom, joinRoom };

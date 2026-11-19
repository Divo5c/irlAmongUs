const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { io: connect } = require('socket.io-client');
const { createHostAccess } = require('../src/config/hostAccess');
const { createHttpServer } = require('../src/httpServer');
const { RoomStore } = require('../src/rooms/roomStore');
const { createSocketServer } = require('../src/socket/socketServer');

test('an activated browser can host through HTTP and Socket.IO; guests can still join', async () => {
  const token = 'x'.repeat(43);
  const hostAccess = createHostAccess(createHash('sha256').update(token).digest('hex'));
  const store = new RoomStore();
  const server = createHttpServer(store, { hostAccess });
  const io = createSocketServer(server, store, { hostAccess });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, payload, headers = {}) => fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const sockets = [];

  function socket(headers = {}) {
    const client = connect(origin, {
      transports: ['websocket'], extraHeaders: headers, forceNew: true, reconnection: false,
    });
    sockets.push(client);
    return client;
  }

  function receive(client, event) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing event ' + event)), 2000);
      client.once(event, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  try {
    assert.deepEqual(await (await fetch(origin + '/host-access')).json(), { canHost: false });
    assert.equal((await post('/host-access', { token: 'invalid' })).status, 403);
    assert.equal((await post('/rooms', { hostId: 'host', hostName: 'Host' })).status, 403);

    const guest = socket();
    const denied = receive(guest, 'room:error');
    guest.emit('room:create', { hostId: 'guest', hostName: 'Guest' });
    assert.equal((await denied).code, 'HOST_DEVICE_REQUIRED');

    const grant = await post('/host-access', { token });
    assert.equal(grant.status, 204);
    const setCookie = grant.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict/);
    const headers = { Cookie: setCookie.split(';')[0] };
    assert.deepEqual(await (await fetch(origin + '/host-access', { headers })).json(), { canHost: true });
    assert.equal((await post('/rooms', { hostId: 'http-host', hostName: 'HTTP host' }, headers)).status, 201);

    const host = socket(headers);
    const created = receive(host, 'room:created');
    host.emit('room:create', { hostId: 'host', hostName: 'Host' });
    const { code } = await created;
    const joined = receive(guest, 'session:created');
    guest.emit('room:join', { code, playerId: 'guest', playerName: 'Guest' });
    assert.equal((await joined).code, code);
  } finally {
    for (const client of sockets) client.disconnect();
    await new Promise((resolve) => io.close(resolve));
  }
});

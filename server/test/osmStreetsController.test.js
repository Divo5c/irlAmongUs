const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStreets } = require('../src/api/osmStreetsController');

test('OSM requires both coordinates before calling Overpass', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{"elements":[]}'));
  await assert.rejects(
    getStreets({ url: '/api/osm/streets?lon=14', socket: { remoteAddress: 'missing-lat' } }, {
      writeHead() {},
      end() {},
    }),
    { statusCode: 400 },
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('OSM retries malformed data and accepts a valid empty result', async (t) => {
  const responses = ['{}', '{"elements":[]}'];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(responses.shift()));
  let result;
  await getStreets({ url: '/api/osm/streets?lat=0&lon=0', socket: { remoteAddress: 'bad-data' } }, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { result = JSON.parse(body); },
  });
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.deepEqual(result.streets, []);
});

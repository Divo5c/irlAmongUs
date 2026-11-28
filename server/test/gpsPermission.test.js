const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gpsPermissionState, gpsErrorState, validPositionFix, requestPosition,
  INITIAL_GPS_WAIT_MS, GAME_GPS_STALE_MS } = require('../public/js/gpsPermission.mjs');

test('GPS permission distinguishes prompt, denial, unavailable service and timeout', () => {
  assert.equal(gpsPermissionState({ permission: 'prompt' }), 'prompt');
  assert.equal(gpsPermissionState({ permission: 'denied' }), 'denied');
  assert.equal(gpsPermissionState({ requested: true, error: gpsErrorState(1) }), 'denied');
  assert.equal(gpsPermissionState({ requested: true, error: gpsErrorState(2) }), 'unavailable');
  assert.equal(gpsPermissionState({ permission: 'granted', error: gpsErrorState(3) }), 'waiting');
  assert.equal(gpsPermissionState({ supported: false }), 'unsupported');
});

test('a fresh valid first fix is required, including after permission recovery', () => {
  const now = 1_000_000;
  const fix = { coords: { latitude: 49, longitude: 11, accuracy: 8 }, timestamp: now };
  const state = { permission: 'granted', fix, now };
  assert.equal(gpsPermissionState({ ...state, error: 'denied' }), 'denied');
  assert.equal(gpsPermissionState(state), 'ready');
  assert.equal(gpsPermissionState({ ...state, now: now + GAME_GPS_STALE_MS + 1 }), 'waiting');
  assert.equal(validPositionFix({ ...fix, timestamp: now + 1 }, now), false);
  assert.equal(validPositionFix({ ...fix, coords: { ...fix.coords, latitude: NaN } }, now), false);
});

test('without the permissions API the geolocation request supplies the result', () => {
  assert.equal(gpsPermissionState({}), 'prompt');
  let result;
  const geolocation = { getCurrentPosition(success, _, options) {
    assert.equal(options.timeout, INITIAL_GPS_WAIT_MS);
    assert.equal(options.maximumAge, 0);
    success({ coords: { latitude: 1, longitude: 1, accuracy: 5 }, timestamp: 1000 });
  } };
  requestPosition(geolocation, (fix) => { result = gpsPermissionState({ requested: true, fix, now: 1000 }); });
  assert.equal(result, 'ready');
});

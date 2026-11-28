export const INITIAL_GPS_WAIT_MS = 20_000;
export const GAME_GPS_STALE_MS = 10_000;

export function validPositionFix(fix, now = Date.now(), maxAgeMs = GAME_GPS_STALE_MS) {
  const { latitude, longitude, accuracy } = fix?.coords ?? {};
  const age = now - fix?.timestamp;
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && Number.isFinite(accuracy) && accuracy >= 0 && age >= 0 && age <= maxAgeMs;
}

export function gpsPermissionState({ supported = true, permission, requested = false, error, fix, now = Date.now() }) {
  if (!supported) return 'unsupported';
  if (permission === 'denied' || error === 'denied') return 'denied';
  if (validPositionFix(fix, now)) return 'ready';
  if (permission === 'prompt' || (!permission && !requested)) return 'prompt';
  if (error === 'unavailable') return 'unavailable';
  return 'waiting';
}

export function gpsErrorState(code) {
  return code === 1 ? 'denied' : code === 2 ? 'unavailable' : 'waiting';
}

export function requestPosition(geolocation, success, failure) {
  geolocation.getCurrentPosition(success, failure, {
    enableHighAccuracy: true, maximumAge: 0, timeout: INITIAL_GPS_WAIT_MS,
  });
}

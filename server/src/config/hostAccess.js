const { createHash, timingSafeEqual } = require('node:crypto');

const COOKIE_NAME = '__Host-rlaus-host-device';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Only the digest of the randomly generated activation key is stored here.
const DEFAULT_HOST_DEVICE_HASH = '8936e845c263bdf2eaf453156948ac78c6197a03f18a5cc755e6d263e2ffba1d';

function createHostAccess(tokenHash = DEFAULT_HOST_DEVICE_HASH) {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) {
    throw new Error('Host-device key hash must be a SHA-256 hex digest.');
  }
  const expected = Buffer.from(tokenHash, 'hex');

  function matches(token) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
    return timingSafeEqual(createHash('sha256').update(token).digest(), expected);
  }

  return {
    allowed(request) {
      const prefix = COOKIE_NAME + '=';
      const cookie = request.headers.cookie?.split(';').map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
      return matches(cookie?.slice(prefix.length));
    },
    activate(token) {
      if (!matches(token)) return null;
      return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
    },
  };
}

module.exports = { createHostAccess };

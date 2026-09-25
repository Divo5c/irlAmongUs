const { GameError } = require('./errors');

/**
 * Server-authoritative game configuration.
 *
 * The config is part of the PUBLIC room projection (clients may display it),
 * but only the host may change it and only while the room is in LOBBY.
 * All values are validated here; clients must never be trusted.
 */
const DEFAULT_GAME_CONFIG = Object.freeze({
  impostorCount: 1,
  tasksPerCrewmate: 2,
  killCooldownMs: 20000,
  discussionDurationMs: 15000,
  votingDurationMs: 30000,
  confirmEjects: true,
  anonymousVoting: false,
});

const NUMERIC_BOUNDS = Object.freeze({
  impostorCount: { min: 1, max: 5 },
  tasksPerCrewmate: { min: 1, max: 8 },
  killCooldownMs: { min: 0, max: 180000 },
  discussionDurationMs: { min: 0, max: 180000 },
  votingDurationMs: { min: 5000, max: 300000 },
});

const NUMERIC_KEYS = Object.freeze(Object.keys(NUMERIC_BOUNDS));
const BOOLEAN_KEYS = Object.freeze(['confirmEjects', 'anonymousVoting']);

/**
 * Upper bound for the impostor count given a player count:
 * impostors must be strictly fewer than crewmates, otherwise the parity
 * victory condition would trigger instantly at game start.
 */
function maxImpostorsFor(playerCount) {
  return Math.max(1, Math.floor((playerCount - 1) / 2));
}

/**
 * Validates a partial config patch and returns a COMPLETE config
 * (defaults merged in). Throws GameError('CONFIG_INVALID') with details
 * { field } for any rejected value. Unknown keys are ignored so that
 * clients can send their full local settings object safely.
 */
function sanitizeGameConfig(input = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new GameError('CONFIG_INVALID', 'Config must be an object.', {
      field: 'config',
    });
  }

  const config = {};

  for (const key of NUMERIC_KEYS) {
    const raw = input[key];
    if (raw === undefined) {
      config[key] = DEFAULT_GAME_CONFIG[key];
      continue;
    }
    const bounds = NUMERIC_BOUNDS[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < bounds.min || raw > bounds.max) {
      throw new GameError(
        'CONFIG_INVALID',
        `Config value "${key}" must be an integer between ${bounds.min} and ${bounds.max}.`,
        { field: key, min: bounds.min, max: bounds.max },
      );
    }
    config[key] = raw;
  }

  for (const key of BOOLEAN_KEYS) {
    const raw = input[key];
    if (raw === undefined) {
      config[key] = DEFAULT_GAME_CONFIG[key];
      continue;
    }
    if (typeof raw !== 'boolean') {
      throw new GameError(
        'CONFIG_INVALID',
        `Config value "${key}" must be a boolean.`,
        { field: key },
      );
    }
    config[key] = raw;
  }

  return config;
}

module.exports = {
  DEFAULT_GAME_CONFIG,
  NUMERIC_BOUNDS,
  maxImpostorsFor,
  sanitizeGameConfig,
};

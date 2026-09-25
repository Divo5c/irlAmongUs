/**
 * Central error type for all game-state violations.
 * `details` carries machine-readable extras (e.g. { retryAfterMs }).
 */
class GameError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.code = code;
    if (details) {
      this.details = details;
    }
  }
}

module.exports = { GameError };

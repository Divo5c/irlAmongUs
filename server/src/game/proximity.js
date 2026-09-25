/**
 * Proximity utilities for real-life gameplay. These are pure functions
 * intended to be called from game-action handlers (kill, report).
 *
 * Currently NOT wired into killPlayer/reportBody — this is the foundation
 * for the proximity enforcement that will be activated once positioning
 * is field-tested.
 */

const { distance } = require('./positioning');

// Default maximum kill distance (world units ≈ meters).
const DEFAULT_KILL_DISTANCE = 3.0;

// Default maximum report distance.
const DEFAULT_REPORT_DISTANCE = 5.0;

// Minimum confidence threshold to allow a proximity-gated action.
const DEFAULT_MIN_CONFIDENCE = 0.4;

/**
 * Checks whether two players are within the specified distance.
 *
 * @param {{ x: number, y: number }} posA
 * @param {{ x: number, y: number }} posB
 * @param {number} maxDistance
 * @returns {{ within: boolean, actualDistance: number }}
 */
function isWithinDistance(posA, posB, maxDistance) {
  const d = distance(posA, posB);
  return { within: d <= maxDistance, actualDistance: d };
}

/**
 * Checks whether a kill action is allowed based on positions.
 * This does NOT check roles, cooldowns, or aliveness — those remain
 * in the existing killPlayer() method. This is purely the proximity gate.
 *
 * @returns {{ allowed: boolean, reason?: string, distance?: number }}
 */
function canKill({ killerPos, targetPos, maxDistance = DEFAULT_KILL_DISTANCE, minConfidence = DEFAULT_MIN_CONFIDENCE }) {
  if (!killerPos || !targetPos) {
    return { allowed: false, reason: 'POSITION_MISSING' };
  }

  if ((killerPos.confidence ?? 0) < minConfidence) {
    return { allowed: false, reason: 'KILLER_CONFIDENCE_TOO_LOW' };
  }

  if ((targetPos.confidence ?? 0) < minConfidence) {
    return { allowed: false, reason: 'TARGET_CONFIDENCE_TOO_LOW' };
  }

  const { within, actualDistance } = isWithinDistance(killerPos, targetPos, maxDistance);
  if (!within) {
    return { allowed: false, reason: 'TOO_FAR', distance: actualDistance };
  }

  return { allowed: true, distance: actualDistance };
}

/**
 * Checks whether a report action is allowed based on position.
 * Reports have a larger radius than kills (finding a body).
 *
 * @returns {{ allowed: boolean, reason?: string, distance?: number }}
 */
function canReport({ reporterPos, bodyPos, maxDistance = DEFAULT_REPORT_DISTANCE, minConfidence = DEFAULT_MIN_CONFIDENCE }) {
  if (!reporterPos || !bodyPos) {
    return { allowed: false, reason: 'POSITION_MISSING' };
  }

  if ((reporterPos.confidence ?? 0) < minConfidence) {
    return { allowed: false, reason: 'REPORTER_CONFIDENCE_TOO_LOW' };
  }

  const { within, actualDistance } = isWithinDistance(reporterPos, bodyPos, maxDistance);
  if (!within) {
    return { allowed: false, reason: 'BODY_TOO_FAR', distance: actualDistance };
  }

  return { allowed: true, distance: actualDistance };
}

module.exports = {
  isWithinDistance,
  canKill,
  canReport,
  DEFAULT_KILL_DISTANCE,
  DEFAULT_REPORT_DISTANCE,
  DEFAULT_MIN_CONFIDENCE,
};

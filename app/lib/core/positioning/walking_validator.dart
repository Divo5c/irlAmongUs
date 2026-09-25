/// Validates that a step event corresponds to real walking, not phone jiggle.
/// Requires temporal regularity + motion state + plausible interval.

import 'motion_classifier.dart';

enum StepSource { hardware, fallback }

class StepValidationResult {
  const StepValidationResult({
    required this.accepted,
    required this.confidence,
    required this.reason,
    required this.source,
  });
  final bool accepted;
  final double confidence;
  final String reason;
  final StepSource source;
}

class WalkingValidator {
  WalkingValidator({
    this.minIntervalMs = 320,
    this.maxIntervalMs = 2000,
    this.requiredConsecutiveSteps = 2,
  });

  final int minIntervalMs;
  final int maxIntervalMs;
  final int requiredConsecutiveSteps;

  final List<int> _recentAcceptedTimes = [];
  int? _lastCandidateTime;
  int _consecutivePlausible = 0;

  // Pass-through counters (read-only diagnostics): how many step events
  // reached the validator, how many were accepted vs. terminally rejected.
  // PENDING (needs a consecutive partner) counts as validated only.
  int _validatedTotal = 0;
  int _acceptedTotal = 0;
  int _rejectedTotal = 0;
  String _lastRejectReason = '—';

  int get validatedTotal => _validatedTotal;
  int get acceptedTotal => _acceptedTotal;
  int get rejectedTotal => _rejectedTotal;
  String get lastRejectReason => _lastRejectReason;

  void reset() {
    _recentAcceptedTimes.clear();
    _lastCandidateTime = null;
    _consecutivePlausible = 0;
    _validatedTotal = 0;
    _acceptedTotal = 0;
    _rejectedTotal = 0;
    _lastRejectReason = '—';
  }

  StepValidationResult validate({
    required int timestampMs,
    required StepSource source,
    required MotionState motionState,
    required double stepConfidence,
  }) {
    _validatedTotal++;
    // If motion classifier says STILL, reject immediately
    if (motionState == MotionState.still) {
      _consecutivePlausible = 0;
      _rejectedTotal++;
      _lastRejectReason = 'REJECT still';
      return StepValidationResult(
        accepted: false,
        confidence: 0,
        reason: 'REJECT still',
        source: source,
      );
    }

    // Interval checks
    if (_lastCandidateTime != null) {
      final interval = timestampMs - _lastCandidateTime!;
      if (interval < minIntervalMs) {
        _rejectedTotal++;
        _lastRejectReason = 'REJECT interval';
        return StepValidationResult(
          accepted: false,
          confidence: 0,
          reason: 'REJECT interval $interval<min',
          source: source,
        );
      }
      if (interval > maxIntervalMs) {
        // Long pause -> reset streak but accept as first step of new walk
        _consecutivePlausible = 0;
      } else {
        // Check periodicity vs last accepted interval if available
        if (_recentAcceptedTimes.length >= 2) {
          final lastInterval = _recentAcceptedTimes[_recentAcceptedTimes.length - 1] -
              _recentAcceptedTimes[_recentAcceptedTimes.length - 2];
          final ratio = lastInterval > 0
              ? (interval < lastInterval
                  ? interval / lastInterval
                  : lastInterval / interval)
              : 1.0;
          if (ratio < 0.35) {
            _consecutivePlausible = 0;
            _lastCandidateTime = timestampMs;
            _rejectedTotal++;
            _lastRejectReason = 'REJECT irregular';
            return StepValidationResult(
              accepted: false,
              confidence: 0,
              reason: 'REJECT irregular $ratio',
              source: source,
            );
          }
        }
      }
    }

    // Hardware steps are more trusted
    final sourceBoost = source == StepSource.hardware ? 0.15 : 0.0;
    final walkConfidence = (stepConfidence + sourceBoost).clamp(0.0, 1.0);

    // Require walking confidence threshold
    if (walkConfidence < 0.40) {
      _consecutivePlausible = 0;
      _lastCandidateTime = timestampMs;
      _rejectedTotal++;
      _lastRejectReason = 'REJECT lowConf';
      return StepValidationResult(
        accepted: false,
        confidence: walkConfidence,
        reason: 'REJECT lowConf $walkConfidence',
        source: source,
      );
    }

    // Require consecutive plausible steps before first acceptance after still
    if (_recentAcceptedTimes.isEmpty) {
      // First plausible step after still/unknown: mark plausible but don't move yet
      _consecutivePlausible++;
      _lastCandidateTime = timestampMs;
      if (_consecutivePlausible < requiredConsecutiveSteps) {
        return StepValidationResult(
          accepted: false,
          confidence: walkConfidence,
          reason: 'PENDING need $_consecutivePlausible/$requiredConsecutiveSteps',
          source: source,
        );
      }
      // Now we have enough consecutive -> accept this one and remember
      _recentAcceptedTimes.add(timestampMs);
      if (_recentAcceptedTimes.length > 6) _recentAcceptedTimes.removeAt(0);
      _acceptedTotal++;
      return StepValidationResult(
        accepted: true,
        confidence: walkConfidence,
        reason: 'ACCEPT firstWalk',
        source: source,
      );
    }

    // Already walking -> accept plausible steps directly
    _consecutivePlausible++;
    _acceptedTotal++;
    _recentAcceptedTimes.add(timestampMs);
    if (_recentAcceptedTimes.length > 6) _recentAcceptedTimes.removeAt(0);
    _lastCandidateTime = timestampMs;
    return StepValidationResult(
      accepted: true,
      confidence: walkConfidence,
      reason: 'ACCEPT walk',
      source: source,
    );
  }

  /// Called when motion becomes STILL to clear walking streak
  void notifyStill() {
    _consecutivePlausible = 0;
  }

  // Diagnostics
  int get consecutivePlausible => _consecutivePlausible;
  int? get lastCandidateTime => _lastCandidateTime;
  List<int> get recentAccepted => List.unmodifiable(_recentAcceptedTimes);
}

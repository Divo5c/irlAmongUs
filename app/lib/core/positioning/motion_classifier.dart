/// Motion state classifier: STILL vs WALKING vs UNKNOWN
/// Uses variance of user-acceleration magnitude and gyroscope magnitude
/// over a sliding window (~1s) to decide if the user's body is moving.

import 'dart:math' as math;

import 'sensor_provider.dart';

enum MotionState { still, walking, unknown }

class MotionClassifier {
  MotionClassifier({
    this.windowSize = 25,
    this.stillAccelVarianceThreshold = 0.18,
    this.stillGyroVarianceThreshold = 0.08,
    this.stillAccelMeanThreshold = 0.7,
    this.walkingMinAccelVariance = 0.35,
  });

  final int windowSize;
  final double stillAccelVarianceThreshold;
  final double stillGyroVarianceThreshold;
  final double stillAccelMeanThreshold;
  final double walkingMinAccelVariance;

  final List<double> _accelMags = [];
  final List<double> _gyroMags = [];

  MotionState _state = MotionState.unknown;
  int _stillStreak = 0;
  int _walkingStreak = 0;

  MotionState get state => _state;
  bool get isStill => _state == MotionState.still;
  bool get isWalking => _state == MotionState.walking;

  // Diagnostics
  double get accelMean => _accelMags.isEmpty ? 0 : _mean(_accelMags);
  double get accelVariance => _accelMags.length < 2 ? 0 : _variance(_accelMags, accelMean);
  double get gyroMean => _gyroMags.isEmpty ? 0 : _mean(_gyroMags);
  double get gyroVariance => _gyroMags.length < 2 ? 0 : _variance(_gyroMags, gyroMean);
  int get accelSamples => _accelMags.length;
  int get gyroSamples => _gyroMags.length;

  void reset() {
    _accelMags.clear();
    _gyroMags.clear();
    _state = MotionState.unknown;
    _stillStreak = 0;
    _walkingStreak = 0;
  }

  void addAcceleration(SensorReading r) {
    final mag = math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    _accelMags.add(mag);
    if (_accelMags.length > windowSize) _accelMags.removeAt(0);
    _evaluate();
  }

  void addGyroscope(SensorReading r) {
    final mag = math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    _gyroMags.add(mag.abs());
    if (_gyroMags.length > windowSize) _gyroMags.removeAt(0);
    _evaluate();
  }

  void _evaluate() {
    if (_accelMags.length < 10) return; // not enough data

    final accelMean = _mean(_accelMags);
    final accelVar = _variance(_accelMags, accelMean);
    final gyroMean = _gyroMags.isEmpty ? 0.0 : _mean(_gyroMags);
    final gyroVar = _gyroMags.length < 6 ? 0.0 : _variance(_gyroMags, gyroMean);

    final isStillNow = accelVar < stillAccelVarianceThreshold &&
        gyroVar < stillGyroVarianceThreshold &&
        accelMean < stillAccelMeanThreshold;

    // Shake has high gyro variance (>0.8) and very high accel variance (>1.0)
    // Walking has moderate accel variance (0.35-2.0) and low-moderate gyro variance
    final isWalkingNow = accelVar > walkingMinAccelVariance &&
        accelVar < 4.0 &&
        gyroVar < 0.6 &&
        accelMean < 1.6;

    // Hysteresis: require 3 consecutive windows to switch
    if (isStillNow) {
      _stillStreak++;
      _walkingStreak = 0;
      if (_stillStreak >= 3) _state = MotionState.still;
    } else if (isWalkingNow) {
      _walkingStreak++;
      _stillStreak = 0;
      if (_walkingStreak >= 2) _state = MotionState.walking;
    } else {
      // Intermediate -> unknown, but don't immediately flip walking->still
      // Require stillStreak to confirm still; otherwise keep previous
      if (_state == MotionState.walking) {
        // stay walking for a bit unless strong still
        _stillStreak = 0;
      } else if (_state == MotionState.still) {
        // stay still unless strong walking
        _walkingStreak = 0;
      } else {
        _state = MotionState.unknown;
      }
      // If unknown for long without still/walking, keep unknown
    }
  }

  double _mean(List<double> v) {
    var s = 0.0;
    for (final e in v) s += e;
    return s / v.length;
  }

  double _variance(List<double> v, double mean) {
    var s = 0.0;
    for (final e in v) {
      final d = e - mean;
      s += d * d;
    }
    return s / v.length;
  }

  /// Force still (zero-velocity) — used when we are certain.
  void forceStill() {
    _state = MotionState.still;
    _stillStreak = 3;
    _walkingStreak = 0;
  }
}

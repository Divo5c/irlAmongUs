/// Step length calibration service.
///
/// Guides the user through a calibration walk to determine their
/// personal step length factor for the PDR engine.
///
/// Calibration process:
///   1. User stands at a known position
///   2. User walks a known distance (e.g., 10m hallway)
///   3. System counts steps and measures average acceleration
///   4. Computes: stepLengthFactor = distance / (steps × √(avgMagnitude))
library;

import 'dart:math' as math;

import 'sensor_provider.dart';

/// Calibration state machine.
enum CalibrationState {
  /// Waiting for user to start.
  idle,

  /// Collecting sensor data during the calibration walk.
  walking,

  /// Processing the collected data.
  processing,

  /// Calibration complete, results ready.
  complete,

  /// Calibration failed.
  error,
}

/// Result of a calibration session.
class CalibrationResult {
  const CalibrationResult({
    required this.stepLengthFactor,
    required this.distanceMeters,
    required this.stepsDetected,
    required this.avgMagnitude,
  });

  final double stepLengthFactor;
  final double distanceMeters;
  final int stepsDetected;
  final double avgMagnitude;

  @override
  String toString() =>
      'Calibration(${stepLengthFactor.toStringAsFixed(3)}, '
      '$stepsDetected steps, ${distanceMeters}m)';
}

/// Manages the calibration process for step length estimation.
class CalibrationService {
  CalibrationState _state = CalibrationState.idle;
  CalibrationResult? _result;

  // Calibration data
  double _targetDistance = 10.0;
  final List<double> _magnitudes = [];
  int _stepsDetected = 0;
  bool _inPeak = false;
  double _peakValue = 0;
  static const _peakThreshold = 0.5;
  static const _minPeakMagnitude = 1.2;
  static const _maxPeakMagnitude = 4.5;
  static const _valleyThreshold = 0.9;
  static const _minStepIntervalMs = 300;
  int _lastStepTimeMs = 0;
  double _valleySinceLastPeak = double.infinity;
  bool _hasValley = true;

  CalibrationState get state => _state;
  CalibrationResult? get result => _result;
  bool get isComplete => _state == CalibrationState.complete;
  bool get isWalking => _state == CalibrationState.walking;
  int get stepsDetected => _stepsDetected;
  double get progress =>
      _targetDistance > 0
          ? (_stepsDetected * estimatedStride / _targetDistance).clamp(0.0, 1.0)
          : 0.0;

  /// Estimated stride length based on current factor (if available).
  double get estimatedStride => _result?.stepLengthFactor != null
      ? _result!.stepLengthFactor * math.sqrt(_minPeakMagnitude)
      : 0.7;

  /// Starts a calibration session.
  ///
  /// [targetDistance] is the distance the user will walk (meters).
  void start(double targetDistance) {
    _targetDistance = targetDistance;
    _state = CalibrationState.walking;
    _result = null;
    _magnitudes.clear();
    _stepsDetected = 0;
    _lastStepTimeMs = 0;
    _inPeak = false;
    _peakValue = 0;
    _valleySinceLastPeak = double.infinity;
    _hasValley = true;
  }

  /// Feeds a user acceleration reading during calibration.
  ///
  /// Returns the current calibration progress (0.0–1.0).
  double feedAcceleration(SensorReading reading) {
    if (_state != CalibrationState.walking) return 0;

    final magnitude = math.sqrt(
      reading.x * reading.x + reading.y * reading.y + reading.z * reading.z,
    );

    if (magnitude < _valleySinceLastPeak) {
      _valleySinceLastPeak = magnitude;
    }
    if (_valleySinceLastPeak < _valleyThreshold) _hasValley = true;

    final isAbove = magnitude > _peakThreshold;

    if (_inPeak && !isAbove) {
      final now = reading.timestampMs;
      final validMag = _peakValue >= _minPeakMagnitude &&
          _peakValue <= _maxPeakMagnitude;
      final validValley = _hasValley || _stepsDetected == 0;
      if (now - _lastStepTimeMs >= _minStepIntervalMs &&
          validMag &&
          validValley) {
        _stepsDetected++;
        _lastStepTimeMs = now;
        _magnitudes.add(_peakValue);
      }
      _valleySinceLastPeak = magnitude;
      _hasValley = false;
    }

    if (magnitude > _peakValue) {
      _peakValue = magnitude;
    }
    _inPeak = isAbove;

    return progress;
  }

  /// Completes the calibration and computes the step length factor.
  ///
  /// Call this after the user has walked the target distance.
  /// [actualDistance] is the real distance walked (meters).
  CalibrationResult complete(double actualDistance) {
    _state = CalibrationState.processing;

    if (_stepsDetected == 0 || _magnitudes.isEmpty) {
      _state = CalibrationState.error;
      return const CalibrationResult(
        stepLengthFactor: 0.55,
        distanceMeters: 10,
        stepsDetected: 0,
        avgMagnitude: 0,
      );
    }

    final avgMagnitude =
        _magnitudes.reduce((a, b) => a + b) / _magnitudes.length;
    final avgStride = actualDistance / _stepsDetected;
    final factor = avgStride / math.sqrt(avgMagnitude);

    _result = CalibrationResult(
      stepLengthFactor: factor.clamp(0.3, 0.9),
      distanceMeters: actualDistance,
      stepsDetected: _stepsDetected,
      avgMagnitude: avgMagnitude,
    );

    _state = CalibrationState.complete;
    return _result!;
  }

  /// Cancels the current calibration session.
  void cancel() {
    _state = CalibrationState.idle;
    _result = null;
    _magnitudes.clear();
    _stepsDetected = 0;
  }

  /// Resets to idle state.
  void reset() {
    cancel();
  }
}

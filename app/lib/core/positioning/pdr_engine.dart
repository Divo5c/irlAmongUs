/// Pedestrian Dead Reckoning (PDR) engine — robust version.
///
/// Robust step detection pipeline:
///   raw magnitude → low-pass filter → peak/valley state machine
///   → interval + magnitude + periodicity confidence → step confirm
///
/// Design goals:
///   - Stationary / tiny wobble → 0 steps
///   - Shake (rapid, irregular, large) → 0 or very few steps
///   - Normal walking (~1.5-2.2 Hz, 1.2-3.0 m/s² peaks) → reliable steps
library;

import 'dart:math' as math;

import 'sensor_provider.dart';

class StepEvent {
  const StepEvent({required this.timestampMs, required this.magnitude});
  final int timestampMs;
  final double magnitude;
}

class PdrUpdate {
  const PdrUpdate({
    required this.x,
    required this.y,
    required this.headingDeg,
    required this.stepsDetected,
    required this.strideLength,
    required this.confidence,
    this.dx = 0,
    this.dy = 0,
  });
  final double x;
  final double y;
  final double headingDeg;
  final int stepsDetected;
  final double strideLength;
  final double confidence;
  final double dx;
  final double dy;
}

enum _DetectorState { idle, rising }

class PdrEngine {
  PdrEngine({
    this.stepLengthFactor = 0.55,
    this.minStepIntervalMs = 300,
    this.maxStepIntervalMs = 1800,
    this.minPeakMagnitude = 1.2,
    this.maxPeakMagnitude = 4.5,
    this.valleyThreshold = 1.4,
    this.stationaryThresholdMs = 2000,
    this.lowPassAlpha = 0.65,
    this.confidenceThreshold = 0.45,
  });

  double stepLengthFactor;
  final int minStepIntervalMs;
  final int maxStepIntervalMs;
  final double minPeakMagnitude;
  final double maxPeakMagnitude;
  final double valleyThreshold;
  final int stationaryThresholdMs;
  final double lowPassAlpha;
  final double confidenceThreshold;

  // Filter state
  double _filteredMag = 0;
  double _prevFiltered = 0;
  bool _filterInitialized = false;

  // Peak tracking
  _DetectorState _state = _DetectorState.idle;
  double _peakCandidate = 0;
  int _peakCandidateTime = 0;
  double _valleySinceLastPeak = double.infinity;
  bool _hasValley = false;

  // Step history
  int _lastStepTimeMs = 0;
  double _lastPeakMag = 0;
  int _lastIntervalMs = 0;
  double _lastConfidence = 0;
  int _totalSteps = 0;
  double _totalDistance = 0;

  double _x = 0, _y = 0, _headingDeg = 0;
  bool _initialized = false;
  double _lastDx = 0, _lastDy = 0, _lastStride = 0;
  double get lastDx => _lastDx;
  double get lastDy => _lastDy;
  double get lastStride => _lastStride;

  int get totalSteps => _totalSteps;
  double get totalDistance => _totalDistance;
  double get x => _x;
  double get y => _y;
  bool get isInitialized => _initialized;
  double get lastConfidence => _lastConfidence;
  int get lastIntervalMs => _lastIntervalMs;
  double get lastPeakMag => _lastPeakMag;

  // Drop diagnostics (read-only): where candidate peaks die, so a real
  // device test can distinguish "no motion" from "filtered everything".
  // Counters only — detection thresholds and logic are untouched.
  int _candidatesTotal = 0;
  int _droppedBelowMin = 0;
  int _droppedInterval = 0;
  int _droppedNoValley = 0;
  int _droppedLowConf = 0;
  String _lastRejectReason = '—';
  double _lastFilteredMag = 0;
  double _lastRawMag = 0;
  int _lastCandidateTimeMs = 0;

  int get candidatesTotal => _candidatesTotal;
  int get droppedBelowMin => _droppedBelowMin;
  int get droppedInterval => _droppedInterval;
  int get droppedNoValley => _droppedNoValley;
  int get droppedLowConf => _droppedLowConf;
  int get droppedTotal =>
      _droppedBelowMin + _droppedInterval + _droppedNoValley + _droppedLowConf;
  String get lastRejectReason => _lastRejectReason;
  double get lastFilteredMag => _lastFilteredMag;
  double get lastRawMag => _lastRawMag;

  /// Timestamp of the most recent validated peak candidate (0 if none yet).
  int get lastCandidateTimeMs => _lastCandidateTimeMs;

  bool isStationary(int nowMs) =>
      !_initialized || (nowMs - _lastStepTimeMs) > stationaryThresholdMs;
  bool get isStationaryNow => isStationary(DateTime.now().millisecondsSinceEpoch);

  void reset() {
    _filteredMag = 0;
    _prevFiltered = 0;
    _filterInitialized = false;
    _state = _DetectorState.idle;
    _peakCandidate = 0;
    _peakCandidateTime = 0;
    _valleySinceLastPeak = double.infinity;
    _hasValley = false;
    _lastStepTimeMs = 0;
    _lastPeakMag = 0;
    _lastIntervalMs = 0;
    _lastConfidence = 0;
    _lastDx = 0;
    _lastDy = 0;
    _lastStride = 0;
    _candidatesTotal = 0;
    _droppedBelowMin = 0;
    _droppedInterval = 0;
    _droppedNoValley = 0;
    _droppedLowConf = 0;
    _lastRejectReason = '—';
    _lastFilteredMag = 0;
    _lastRawMag = 0;
    _lastCandidateTimeMs = 0;
    _totalSteps = 0;
    _totalDistance = 0;
    _x = 0;
    _y = 0;
    _headingDeg = 0;
    _initialized = false;
  }

  void setPosition(double x, double y, {double headingDeg = 0}) {
    _x = x;
    _y = y;
    _headingDeg = headingDeg;
    _initialized = true;
    // Reset peak detector but keep step count / distance?
    // For scan start we want step count reset, but setPosition is also
    // used for map-matching sync — there we should NOT reset step count.
    // So don't reset step count here, only filter state.
    _filteredMag = 0;
    _prevFiltered = 0;
    _filterInitialized = false;
    _state = _DetectorState.idle;
    _peakCandidate = 0;
    _valleySinceLastPeak = double.infinity;
    _hasValley = true; // allow first step without prior valley
  }

  PdrUpdate? processAcceleration(SensorReading reading, double headingDeg) {
    final rawMag = math.sqrt(
        reading.x * reading.x + reading.y * reading.y + reading.z * reading.z);
    _headingDeg = headingDeg;

    // Low-pass filter
    if (!_filterInitialized) {
      _filteredMag = rawMag;
      _prevFiltered = rawMag;
      _filterInitialized = true;
    } else {
      _prevFiltered = _filteredMag;
      _filteredMag = lowPassAlpha * rawMag + (1 - lowPassAlpha) * _filteredMag;
    }
    _lastRawMag = rawMag;
    _lastFilteredMag = _filteredMag;

    // Hysteresis to avoid jitter
    const hysteresis = 0.06;
    final isFalling = _filteredMag < _prevFiltered - hysteresis;

    // Track valley (minimum since last peak)
    if (_filteredMag < _valleySinceLastPeak) {
      _valleySinceLastPeak = _filteredMag;
    }
    if (_valleySinceLastPeak < valleyThreshold) {
      _hasValley = true;
    }

    switch (_state) {
      case _DetectorState.idle:
        if (_filteredMag > 0.8 || rawMag > 1.0) {
          _state = _DetectorState.rising;
          _peakCandidate = _filteredMag;
          _peakCandidateTime = reading.timestampMs;
        }
        break;
      case _DetectorState.rising:
        if (_filteredMag > _peakCandidate) {
          _peakCandidate = _filteredMag;
          _peakCandidateTime = reading.timestampMs;
        }
        if (isFalling) {
          // Peak found — validate
          final peak = _peakCandidate;
          final peakTime = _peakCandidateTime;
          // Reset for next detection
          _state = _DetectorState.idle;
          _peakCandidate = 0;

          final result = _validateAndRegister(peak, peakTime, rawMag);
          // After a peak, reset valley tracking
          _valleySinceLastPeak = _filteredMag;
          _hasValley = false;
          if (result != null) return result;
        }
        // If magnitude fell below low threshold without a clear peak, reset
        if (_filteredMag < 0.3) {
          _state = _DetectorState.idle;
          _peakCandidate = 0;
        }
        break;
    }
    return null;
  }

  PdrUpdate? _validateAndRegister(double peakFiltered, int peakTime, double rawPeak) {
    final now = peakTime;

    // Use raw peak for magnitude check (more discriminative), but filtered peak for valley logic
    // For magnitude validation, use max of filtered and raw to avoid under-counting due to filtering
    final magForCheck = math.max(peakFiltered, rawPeak * 0.85);

    _candidatesTotal++;
    _lastCandidateTimeMs = peakTime;
    if (magForCheck < minPeakMagnitude) {
      _droppedBelowMin++;
      _lastRejectReason = 'below-min';
      return null;
    }
    if (magForCheck > maxPeakMagnitude) {
      // Very large peaks are likely shake — require extra consistency
      // Don't outright reject, but will get low confidence
    }

    // Interval check
    final interval = _lastStepTimeMs == 0 ? 9999 : now - _lastStepTimeMs;
    if (_lastStepTimeMs != 0 && interval < minStepIntervalMs) {
      _droppedInterval++;
      _lastRejectReason = 'interval';
      return null;
    }
    // Very long interval is okay (person stopped then walked) — don't reject, just low periodicity confidence

    // Valley check — must have dipped before this peak (except for very first step)
    if (_totalSteps > 0 && !_hasValley) {
      _droppedNoValley++;
      _lastRejectReason = 'no-valley';
      return null;
    }

    // Compute confidence
    final confidence = _computeConfidence(magForCheck, interval);
    if (confidence < confidenceThreshold) {
      _droppedLowConf++;
      _lastRejectReason = 'low-conf';
      return null;
    }

    return _registerStep(now, magForCheck, confidence);
  }

  double _computeConfidence(double mag, int intervalMs) {
    // Magnitude confidence
    double magC;
    if (mag < minPeakMagnitude) {
      magC = 0;
    } else if (mag < 1.5) {
      magC = 0.6;
    } else if (mag <= 2.8) {
      magC = 1.0;
    } else if (mag <= 3.5) {
      magC = 0.65;
    } else if (mag <= 4.5) {
      magC = 0.3;
    } else {
      magC = 0.08;
    }

    // Interval confidence
    double intervalC;
    if (_lastStepTimeMs == 0) {
      // First step: no interval history, neutral
      intervalC = 0.7;
    } else if (intervalMs < 250) {
      intervalC = 0;
    } else if (intervalMs < 300) {
      intervalC = 0.25;
    } else if (intervalMs < 400) {
      intervalC = 0.65;
    } else if (intervalMs <= 900) {
      intervalC = 1.0;
    } else if (intervalMs <= 1400) {
      intervalC = 0.65;
    } else if (intervalMs <= 2000) {
      intervalC = 0.4;
    } else {
      intervalC = 0.3;
    }

    // Periodicity confidence
    double periodicityC;
    if (_lastIntervalMs == 0 || _lastStepTimeMs == 0) {
      periodicityC = 0.7;
    } else {
      final ratio = math.min(intervalMs, _lastIntervalMs) /
          math.max(intervalMs, _lastIntervalMs);
      if (ratio > 0.75) {
        periodicityC = 1.0;
      } else if (ratio > 0.55) {
        periodicityC = 0.6;
      } else if (ratio > 0.35) {
        periodicityC = 0.3;
      } else {
        periodicityC = 0.12;
      }
      // Also penalize if both intervals are very short (shake)
      if (intervalMs < 350 && _lastIntervalMs < 350) {
        periodicityC *= 0.5;
      }
    }

    // Weighted
    return magC * 0.5 + intervalC * 0.30 + periodicityC * 0.20;
  }

  PdrUpdate? registerManualStep(int timestampMs) {
    if (timestampMs - _lastStepTimeMs < minStepIntervalMs) return null;
    return _registerStep(timestampMs, minPeakMagnitude + 0.5, 0.9);
  }

  /// Hardware step detector path: fixed stride derived from calibration,
  /// confidence supplied by WalkingValidator.
  PdrUpdate? onHardwareStep(int timestampMs, double headingDeg, double confidence) {
    if (timestampMs - _lastStepTimeMs < minStepIntervalMs) return null;
    _headingDeg = headingDeg;
    // Use typical walking magnitude ~1.9 for stride calc
    const typicalMag = 1.9;
    return _registerStep(timestampMs, typicalMag, confidence);
  }

  PdrUpdate _registerStep(int timestampMs, double peakMagnitude, double confidence) {
    final interval = _lastStepTimeMs == 0 ? 0 : timestampMs - _lastStepTimeMs;
    _lastStepTimeMs = timestampMs;
    _lastIntervalMs = interval;
    _lastPeakMag = peakMagnitude;
    _lastConfidence = confidence;
    _totalSteps++;

    final stride = stepLengthFactor * math.sqrt(peakMagnitude);
    // Confidence-weighted stride: low confidence steps make shorter stride (reduces drift from false positives)
    final effectiveStride = stride * (0.6 + 0.4 * confidence);
    _totalDistance += effectiveStride;

    final headingRad = _headingDeg * math.pi / 180.0;
    // 0° = north (-Y up on screen), 90° = east (+X right)
    _x += effectiveStride * math.sin(headingRad);
    _y += -effectiveStride * math.cos(headingRad);
    _lastDx = effectiveStride * math.sin(headingRad);
    _lastDy = -effectiveStride * math.cos(headingRad);
    _lastStride = effectiveStride;

    return PdrUpdate(
      x: _x,
      y: _y,
      headingDeg: _headingDeg,
      stepsDetected: _totalSteps,
      strideLength: effectiveStride,
      confidence: confidence,
      dx: _lastDx,
      dy: _lastDy,
    );
  }

  void calibrate(double distanceMeters, int stepCount, double avgMagnitude) {
    if (stepCount <= 0 || avgMagnitude <= 0) return;
    final avgStride = distanceMeters / stepCount;
    stepLengthFactor = (avgStride / math.sqrt(avgMagnitude)).clamp(0.3, 0.9);
  }
}

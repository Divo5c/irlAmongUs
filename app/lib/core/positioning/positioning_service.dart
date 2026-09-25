/// Client-side positioning service — robust PDR 2.0
///
/// Architecture:
///   Sensor → [SensorProvider] → MotionClassifier → WalkingValidator → PDR → PositionEstimate
///   Hardware step detector preferred, fallback PDR otherwise.
///   Position only moves on VALIDATED walking steps.

import 'dart:async';
import 'dart:math' as math;

import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';

import 'calibration_service.dart';
import 'heading_fusion.dart';
import 'heading_snapper.dart';
import 'motion_classifier.dart';
import 'pdr_engine.dart';
import 'sensor_provider.dart';
import 'walking_validator.dart';

class PositionUpdateThresholds {
  const PositionUpdateThresholds({
    this.minIntervalMs = 500,
    this.minDistanceMoved = 0.5,
    this.minHeadingChangeDeg = 15,
  });
  final int minIntervalMs;
  final double minDistanceMoved;
  final double minHeadingChangeDeg;
}

class StepDiagnostic {
  const StepDiagnostic({
    required this.stepNumber,
    required this.timestampMs,
    required this.headingDeg,
    required this.stride,
    required this.dx,
    required this.dy,
    required this.worldX,
    required this.worldY,
    required this.motionState,
    required this.validatorReason,
    required this.source,
    required this.confidence,
  });
  final int stepNumber;
  final int timestampMs;
  final double headingDeg;
  final double stride;
  final double dx;
  final double dy;
  final double worldX;
  final double worldY;
  final MotionState motionState;
  final String validatorReason;
  final StepSource source;
  final double confidence;
}

const String kBuildVersion = '1.0.0+1 PDR2.4-stepTrace 2026-09-10';

class SensorStatus {
  const SensorStatus({
    required this.capabilities,
    required this.isRunning,
    required this.stepCount,
    required this.totalDistance,
    required this.calibrationState,
    this.calibrationResult,
    this.headingDeg,
    this.headingConfidence,
    this.lastPosition,
    this.isStationary,
    this.lastStepConfidence,
    this.lastIntervalMs,
    this.motionState,
    this.stepSource,
    this.walkingConfidence,
    this.lastStepReason,
    this.useHardwareStepDetector,
    this.motionAccelMean,
    this.motionAccelVar,
    this.motionGyroMean,
    this.motionGyroVar,
    this.validatorConsecutive,
    this.validatorInterval,
    this.headingRaw,
    this.gyroDeltaDeg,
    this.magX,
    this.magY,
    this.magZ,
    this.pdrDx,
    this.pdrDy,
    this.lastStride,
    this.hardwareStepCount,
    this.lastHardwareStepTime,
    this.lastAccel,
    this.lastGyro,
    this.lastMag,
    this.lastUserAccel,
    this.buildVersion,
    this.fallbackActive,
    this.failoverReason,
    this.stepDetectorError,
    this.pdrCandidates,
    this.pdrRejected,
    this.pdrLastReject,
    this.pdrLastFilt,
    this.pdrLastRaw,
    this.pdrLastCandidateTs,
    this.accelSamples,
    this.fallbackSamples,
    this.validatorValidated,
    this.validatorAccepted,
    this.validatorRejected,
    this.validatorLastReject,
    this.lastAcceptedStepMs,
  });

  final SensorCapabilities capabilities;
  final bool isRunning;
  final int stepCount;
  final double totalDistance;
  final CalibrationState calibrationState;
  final CalibrationResult? calibrationResult;
  final double? headingDeg;
  final double? headingConfidence;
  final PositionEstimate? lastPosition;
  final bool? isStationary;
  final double? lastStepConfidence;
  final int? lastIntervalMs;
  final MotionState? motionState;
  final StepSource? stepSource;
  final double? walkingConfidence;
  final String? lastStepReason;
  final bool? useHardwareStepDetector;
  final double? motionAccelMean;
  final double? motionAccelVar;
  final double? motionGyroMean;
  final double? motionGyroVar;
  final int? validatorConsecutive;
  final int? validatorInterval;
  final double? headingRaw;
  final double? gyroDeltaDeg;
  final double? magX;
  final double? magY;
  final double? magZ;
  final double? pdrDx;
  final double? pdrDy;
  final double? lastStride;
  final int? hardwareStepCount;
  final int? lastHardwareStepTime;
  final SensorReading? lastAccel;
  final SensorReading? lastGyro;
  final SensorReading? lastMag;
  final SensorReading? lastUserAccel;
  final String? buildVersion;
  final bool? fallbackActive;
  final String? failoverReason;
  final String? stepDetectorError;
  final int? pdrCandidates;
  final int? pdrRejected;
  final String? pdrLastReject;
  final double? pdrLastFilt;
  final double? pdrLastRaw;
  final int? pdrLastCandidateTs;
  final int? accelSamples;
  final int? fallbackSamples;
  final int? validatorValidated;
  final int? validatorAccepted;
  final int? validatorRejected;
  final String? validatorLastReject;
  final int? lastAcceptedStepMs;

  @override
  String toString() =>
      'SensorStatus(running=$isRunning, steps=$stepCount, motion=$motionState, cal=$calibrationState)';
}

class PositioningService {
  PositioningService({
    this.map,
    this.thresholds = const PositionUpdateThresholds(),
    SensorProvider? sensorProvider,
  }) : _sensorProvider = sensorProvider;

  GameMapData? map;
  final PositionUpdateThresholds thresholds;
  final SensorProvider? _sensorProvider;

  PositionEstimate? _currentPosition;
  PositionEstimate? _lastSentPosition;
  DateTime? _lastSendTime;

  bool _debugMode = false;
  bool _sensorMode = false;

  late final PdrEngine _pdr = PdrEngine();
  late final HeadingFusion _heading = HeadingFusion();
  late final CalibrationService _calibration = CalibrationService();
  final MotionClassifier _motion = MotionClassifier();
  final WalkingValidator _validator = WalkingValidator();

  /// Quantizes the fused heading to 90-degree steps for PDR displacement
  /// only. Raw headings (arrow, estimates, diagnostics) are unaffected.
  final HeadingSnapper _snapper = HeadingSnapper();

  StreamSubscription<SensorReading>? _userAccelSub;
  StreamSubscription<SensorReading>? _gyroSub;
  StreamSubscription<SensorReading>? _magnetSub;
  StreamSubscription<SensorReading>? _stepDetectorSub;
  StreamSubscription<SensorReading>? _accelSub;

  bool _useHardware = false;
  String _lastStepReason = '—';
  double _lastWalkingConfidence = 0;
  StepSource? _lastStepSource;

  /// Failover: when the hardware step-detector stream proves dead (native
  /// error, or silence during sustained walking), fallback PDR takes over
  /// step advancement. Sticky until reset/re-enable; hardware events arriving
  /// while fallback is active are counted for diagnostics only (no double
  /// counting). No new detection is invented — only the existing fallback
  /// PDR path is selected.
  bool _fallbackActive = false;
  String? _failoverReason;
  String? _stepDetectorErrorMsg;
  int? _firstWalkingTsMs;

  /// Timestamp of the last actually counted step (either path). Used to
  /// detect a live-but-fruitless pipeline: continuous walking with zero
  /// accepted steps means the active path is rejecting everything.
  int? _lastAcceptedStepMs;

  /// Grace period of continuous walking with zero raw hardware events before
  /// the silent-channel failover engages. Healthy hardware delivers within
  /// ~1s; 8s is far beyond that but short enough for UX.
  static const int _hwGraceMs = 8000;

  SensorReading? _lastAccelReading;
  SensorReading? _lastUserAccelReading;
  SensorReading? _lastGyroReading;
  SensorReading? _lastMagReading;

  /// Pipeline trace counters (read-only diagnostics): raw accelerometer
  /// samples seen and fallback samples actually processed. Together with
  /// PDR candidate/drop counters and validator accepted/rejected counters
  /// they show exactly at which stage steps get lost.
  int _accelSampleCount = 0;
  int _fallbackSampleCount = 0;
  int _hardwareStepCount = 0;
  int _lastHardwareStepTime = 0;
  final List<StepDiagnostic> _stepLog = [];
  List<StepDiagnostic> get stepLog => List.unmodifiable(_stepLog);

  PositionEstimate? get currentPosition => _currentPosition;
  bool get isDebugMode => _debugMode;
  bool get isSensorMode => _sensorMode;

  SensorStatus get sensorStatus => SensorStatus(
        capabilities: _sensorProvider?.capabilities ?? const SensorCapabilities(),
        isRunning: _sensorMode,
        stepCount: _pdr.totalSteps,
        totalDistance: _pdr.totalDistance,
        calibrationState: _calibration.state,
        calibrationResult: _calibration.result,
        headingDeg: _heading.headingDeg,
        headingConfidence: _heading.confidence,
        lastPosition: _currentPosition,
        isStationary: _motion.isStill,
        lastStepConfidence: _pdr.lastConfidence,
        lastIntervalMs: _pdr.lastIntervalMs,
        motionState: _motion.state,
        stepSource: _lastStepSource,
        walkingConfidence: _lastWalkingConfidence,
        lastStepReason: _lastStepReason,
        useHardwareStepDetector: _useHardware,
        motionAccelMean: _motion.accelMean,
        motionAccelVar: _motion.accelVariance,
        motionGyroMean: _motion.gyroMean,
        motionGyroVar: _motion.gyroVariance,
        validatorConsecutive: _validator.consecutivePlausible,
        validatorInterval: _validator.lastCandidateTime != null ? DateTime.now().millisecondsSinceEpoch - _validator.lastCandidateTime! : null,
        headingRaw: _heading.lastRawMagHeading,
        gyroDeltaDeg: _heading.lastGyroDeltaDeg,
        magX: _heading.lastMx,
        magY: _heading.lastMy,
        magZ: _heading.lastMz,
        pdrDx: _pdr.lastDx,
        pdrDy: _pdr.lastDy,
        lastStride: _pdr.lastStride,
        hardwareStepCount: _hardwareStepCount,
        lastHardwareStepTime: _lastHardwareStepTime,
        lastAccel: _lastAccelReading,
        lastGyro: _lastGyroReading,
        lastMag: _lastMagReading,
        lastUserAccel: _lastUserAccelReading,
        buildVersion: kBuildVersion,
        fallbackActive: _fallbackActive,
        failoverReason: _failoverReason,
        stepDetectorError: _stepDetectorErrorMsg,
        pdrCandidates: _pdr.candidatesTotal,
        pdrRejected: _pdr.droppedTotal,
        pdrLastReject: _pdr.lastRejectReason,
        pdrLastFilt: _pdr.lastFilteredMag,
        pdrLastRaw: _pdr.lastRawMag,
        pdrLastCandidateTs: _pdr.lastCandidateTimeMs,
        accelSamples: _accelSampleCount,
        fallbackSamples: _fallbackSampleCount,
        validatorValidated: _validator.validatedTotal,
        validatorAccepted: _validator.acceptedTotal,
        validatorRejected: _validator.rejectedTotal,
        validatorLastReject: _validator.lastRejectReason,
        lastAcceptedStepMs: _lastAcceptedStepMs,
      );

  final _positionStreamController = StreamController<PositionEstimate>.broadcast();
  Stream<PositionEstimate> get positionStream => _positionStreamController.stream;

  /// Live fused heading (degrees, 0=north) from HeadingFusion/Sensor-Updates.
  /// Read-only view of the existing heading state — updated on every gyro/
  /// magnetometer sample, independent of PDR steps. Null until the first
  /// magnetometer sample initializes the fusion.
  double? get liveHeadingDeg => _heading.headingDeg;

  final _headingStreamController = StreamController<double>.broadcast();

  /// Emits the live fused heading whenever it changes by at least 1 degree
  /// (wrap-aware). Lets the debug arrow rotate without waiting for steps.
  /// Publication only — the heading computation itself is untouched.
  Stream<double> get headingStream => _headingStreamController.stream;

  double? _lastEmittedHeading;

  void _maybeEmitHeading() {
    final h = _heading.headingDeg;
    if (h == null) return;
    final last = _lastEmittedHeading;
    if (last == null) {
      _lastEmittedHeading = h;
      _headingStreamController.add(h);
      return;
    }
    var diff = (h - last).abs();
    if (diff > 180) diff = 360 - diff;
    if (diff >= 1.0) {
      _lastEmittedHeading = h;
      _headingStreamController.add(h);
    }
  }

  void enableDebugMode() {
    _debugMode = true;
    _sensorMode = false;
    _stopSensorListening();
  }

  void enableSensorMode() {
    _sensorMode = true;
    _debugMode = false;
    _startSensorListening();
  }

  void disable() {
    _debugMode = false;
    _sensorMode = false;
    _stopSensorListening();
  }

  void setInitialPosition(double x, double y, {double headingDeg = 0}) {
    _pdr.setPosition(x, y, headingDeg: headingDeg);
    _motion.reset();
    _validator.reset();
    _snapper.reset();
    _lastStepReason = 'init';
    // Publish the known scan origin immediately: the PDR engine already
    // tracks (x, y), but without this _currentPosition stays null until the
    // first validated step, which forced "+ Point" into its synthetic
    // fallback. Mirrors resetPosition().
    _currentPosition = PositionEstimate(
      x: x,
      y: y,
      heading: headingDeg,
      confidence: 1.0,
      source: PositionSource.fused,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    _positionStreamController.add(_currentPosition!);
  }

  void updateManualPosition(double worldX, double worldY, {double? heading}) {
    if (!_debugMode) return;
    final estimate = PositionEstimate(
      x: worldX,
      y: worldY,
      heading: heading,
      confidence: 1.0,
      source: PositionSource.manualDebug,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    _updatePosition(estimate);
  }

  void updateSensorPosition({
    required double x,
    required double y,
    double? heading,
    required double confidence,
    required PositionSource source,
  }) {
    final estimate = PositionEstimate(
      x: x,
      y: y,
      heading: heading,
      confidence: confidence,
      source: source,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    _updatePosition(estimate);
  }

  void applyServerConfirmation(Map<String, dynamic> data) {
    final confirmed = PositionEstimate.fromServer(data);
    _currentPosition = confirmed;
    _lastSentPosition = confirmed;
    _lastSendTime = DateTime.now();
    _positionStreamController.add(confirmed);
    if (_pdr.isInitialized) {
      _pdr.setPosition(confirmed.x, confirmed.y, headingDeg: confirmed.heading ?? 0);
    }
  }

  bool shouldSendUpdate(PositionEstimate candidate) {
    final now = DateTime.now();
    if (_lastSentPosition == null || _lastSendTime == null) return true;
    final elapsed = now.difference(_lastSendTime!).inMilliseconds;
    if (elapsed < thresholds.minIntervalMs) return false;
    final dx = candidate.x - _lastSentPosition!.x;
    final dy = candidate.y - _lastSentPosition!.y;
    final distance = math.sqrt(dx * dx + dy * dy);
    if (distance >= thresholds.minDistanceMoved) return true;
    if (candidate.heading != null && _lastSentPosition!.heading != null) {
      var headingDiff = (candidate.heading! - _lastSentPosition!.heading!).abs();
      if (headingDiff > 180) headingDiff = 360 - headingDiff;
      if (headingDiff >= thresholds.minHeadingChangeDeg) return true;
    }
    return false;
  }

  void startCalibration(double targetDistance) => _calibration.start(targetDistance);
  CalibrationResult completeCalibration(double actualDistance) {
    final result = _calibration.complete(actualDistance);
    _pdr.calibrate(actualDistance, result.stepsDetected, result.avgMagnitude);
    return result;
  }

  void cancelCalibration() => _calibration.cancel();

  // ---------------- Map snap ----------------
  PositionEstimate _applyMapSnap(PositionEstimate est) {
    final m = map;
    if (m == null || m.corridors.isEmpty) return est;
    for (final room in m.rooms) {
      if (_pointInPolygon(est.x, est.y, room.polygon)) return est;
    }
    double bestDist = double.infinity;
    double snapX = est.x, snapY = est.y;
    for (final c in m.corridors) {
      final a = m.nodeById(c.a);
      final b = m.nodeById(c.b);
      if (a == null || b == null) continue;
      final r = _closestPointOnSegment(est.x, est.y, a.x, a.y, b.x, b.y);
      final dx = est.x - r.$1, dy = est.y - r.$2;
      final d = math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        snapX = r.$1;
        snapY = r.$2;
      }
    }
    const snapThreshold = 4.0, snapBlend = 0.30;
    if (bestDist < snapThreshold && bestDist > 0.05) {
      return PositionEstimate(
        x: est.x + (snapX - est.x) * snapBlend,
        y: est.y + (snapY - est.y) * snapBlend,
        heading: est.heading,
        confidence: est.confidence,
        source: est.source,
        timestamp: est.timestamp,
        roomId: est.roomId,
        onCorridor: true,
      );
    }
    return est;
  }

  bool _pointInPolygon(double px, double py, List<(double, double)> poly) {
    if (poly.length < 3) return false;
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      final xi = poly[i].$1, yi = poly[i].$2;
      final xj = poly[j].$1, yj = poly[j].$2;
      final intersect = ((yi > py) != (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  (double, double) _closestPointOnSegment(double px, double py, double ax, double ay, double bx, double by) {
    final abx = bx - ax, aby = by - ay;
    final apx = px - ax, apy = py - ay;
    final ab2 = abx * abx + aby * aby;
    if (ab2 == 0) return (ax, ay);
    var t = (apx * abx + apy * aby) / ab2;
    t = t.clamp(0.0, 1.0);
    return (ax + abx * t, ay + aby * t);
  }

  /// Gap-filling: fallback PDR may also run while the hardware path is
  /// selected, but only after [_minWalkingStreak] consecutive walking
  /// samples and only when no raw hardware event arrived within
  /// [_hwSuppressMs]. Healthy hardware (≈0.5 s step cadence) keeps fallback
  /// suppressed; one footstep can never count twice because its
  /// acceleration signature spans < 1 s. With dead or sparse hardware the
  /// fallback covers the gaps quickly, which makes stop-and-go map scanning
  /// work. The streak requirement keeps transient states out: a shake
  /// passes through the walking band only while the motion window slides
  /// (measured: at most ~23 consecutive samples), whereas real walking
  /// sustains it indefinitely (activation latency ~0.6 s at 50 Hz).
  /// Sitting stays frozen via the still gate. No detector/threshold is
  /// changed — this only decides WHEN the existing fallback may run.
  static const int _hwSuppressMs = 2000;
  static const int _minWalkingStreak = 30;

  /// Consecutive samples classified as motion WALKING (own counter; the
  /// classifier itself is untouched).
  int _walkingStreak = 0;

  bool _hardwareFresh(int nowMs) =>
      _lastHardwareStepTime != 0 &&
      (nowMs - _lastHardwareStepTime) <= _hwSuppressMs;

  /// Switches step advancement from hardware to the existing fallback PDR.
  /// Sticky until reset/re-enable. The hardware subscription is kept (for
  /// diagnostics and recovery) but its events no longer advance position,
  /// so double counting is impossible.
  void _switchToFallback(String reason) {
    if (_fallbackActive) return;
    _fallbackActive = true;
    _useHardware = false;
    _failoverReason = reason;
    _lastStepSource = StepSource.fallback;
    _lastStepReason = 'FALLBACK $reason';
  }

  /// Failover watchdog for a fruitless step pipeline. Returns the failover
  /// reason, or null when healthy. Fires only during continuous walking
  /// (standing still resets the grace timer, so a fresh walk always gives
  /// healthy hardware a full grace period first):
  /// (a) 'no-hw-events': zero raw hardware events for [_hwGraceMs], or
  /// (b) 'no-accepted-steps': zero *accepted* steps for [_hwAcceptGraceMs] —
  ///     covers sparse hardware blips that disarm (a) via the raw counter
  ///     yet never pass validation, leaving the session frozen with rescue.
  /// A healthy device accepts steps within ~1s of walking, so neither
  /// criterion can fire there.
  static const int _hwAcceptGraceMs = 12000;

  String? _failoverCheck(SensorReading reading) {
    if (_fallbackActive) return null;
    if (_motion.isStill) {
      _firstWalkingTsMs = null;
      return null;
    }
    if (_motion.state != MotionState.walking) return null;
    final now = reading.timestampMs;
    _firstWalkingTsMs ??= now;
    final walkingSince = now - _firstWalkingTsMs!;
    if (_hardwareStepCount == 0 && walkingSince > _hwGraceMs) {
      return 'no-hw-events';
    }
    final lastAccepted = _lastAcceptedStepMs;
    final acceptRef =
        (lastAccepted != null && lastAccepted > _firstWalkingTsMs!)
            ? lastAccepted
            : _firstWalkingTsMs!;
    if (now - acceptRef > _hwAcceptGraceMs) return 'no-accepted-steps';
    return null;
  }

  /// Fallback PDR processing for one acceleration sample. Unchanged logic,
  /// extracted verbatim so the hardware-failover path shares it.
  void _processFallbackReading(SensorReading reading) {
    _fallbackSampleCount++;
    if (_motion.isStill) {
      _validator.notifyStill();
      _lastStepReason = 'REJECT still';
      _lastStepSource = StepSource.fallback;
      _lastWalkingConfidence = 0;
      return;
    }
    final heading = _heading.headingDeg ?? 0;
    // Snapped heading drives PDR displacement only; the raw heading stays
    // on the estimate, arrow and diagnostics.
    final moveHeading = _snapper.snap(heading).toDouble();
    final update = _pdr.processAcceleration(reading, moveHeading);
    if (update != null) {
      _lastAcceptedStepMs = reading.timestampMs;
      _lastStepSource = StepSource.fallback;
      _lastWalkingConfidence = update.confidence;
      _lastStepReason = 'ACCEPT fallback conf=${update.confidence.toStringAsFixed(2)}';
      var est = PositionEstimate(
        x: update.x,
        y: update.y,
        heading: heading,
        confidence: update.confidence * _heading.confidence,
        source: PositionSource.fused,
        timestamp: reading.timestampMs,
      );
      est = _applyMapSnap(est);
      if ((est.x - update.x).abs() > 0.01 || (est.y - update.y).abs() > 0.01) {
        _pdr.setPosition(est.x, est.y, headingDeg: moveHeading);
      }
      _updatePosition(est);
      _stepLog.add(StepDiagnostic(
        stepNumber: update.stepsDetected,
        timestampMs: reading.timestampMs,
        headingDeg: moveHeading,
        stride: update.strideLength,
        dx: update.dx,
        dy: update.dy,
        worldX: est.x,
        worldY: est.y,
        motionState: _motion.state,
        validatorReason: _lastStepReason,
        source: StepSource.fallback,
        confidence: update.confidence,
      ));
      if (_stepLog.length > 50) _stepLog.removeAt(0);
    }
  }

  void _startSensorListening() {
    if (_sensorProvider == null) return;
    _sensorProvider!.start();
    // Fresh session: retry hardware first, clear any previous failover.
    _fallbackActive = false;
    _lastEmittedHeading = null;
    _failoverReason = null;
    _stepDetectorErrorMsg = null;
    _firstWalkingTsMs = null;
    // NOTE: capabilities.hasStepDetector is optimistically true until the
    // native channel answers. The decision below only selects the PRIMARY
    // path; a late native error (or a silent channel during sustained
    // walking) fails over to fallback PDR dynamically via _switchToFallback.
    _useHardware = _sensorProvider!.capabilities.hasStepDetector;

    _accelSub = _sensorProvider!.accelerometer.listen((r) {
      _lastAccelReading = r;
    });

    _gyroSub = _sensorProvider!.gyroscope.listen((reading) {
      _lastGyroReading = reading;
      _motion.addGyroscope(reading);
      if (_motion.isStill) return;
      _heading.updateFromGyroscope(reading.z, reading.timestampMs);
      _maybeEmitHeading();
    });

    _magnetSub = _sensorProvider!.magnetometer.listen((reading) {
      _lastMagReading = reading;
      _heading.updateFromMagnetometer(reading.x, reading.y, reading.timestampMs, reading.z);
      _maybeEmitHeading();
    });

    if (_useHardware) {
      _stepDetectorSub = _sensorProvider!.stepDetector.listen(
        (event) {
          _hardwareStepCount++;
          _lastHardwareStepTime = event.timestampMs;
          if (_fallbackActive) return; // raw count only, no double counting
          final heading = _heading.headingDeg ?? 0;
          final vr = _validator.validate(
            timestampMs: event.timestampMs,
            source: StepSource.hardware,
            motionState: _motion.state,
            stepConfidence: 0.85,
          );
          _lastStepSource = StepSource.hardware;
          _lastWalkingConfidence = vr.confidence;
          _lastStepReason = vr.reason;
          if (!vr.accepted) {
            if (_motion.isStill) _validator.notifyStill();
            return;
          }
        // Snapped heading drives PDR displacement only; the raw heading
        // stays on the estimate, arrow and diagnostics.
        final moveHeading = _snapper.snap(heading).toDouble();
        final upd = _pdr.onHardwareStep(event.timestampMs, moveHeading, vr.confidence);
        if (upd != null) {
          _lastAcceptedStepMs = event.timestampMs;
          var est = PositionEstimate(
              x: upd.x,
              y: upd.y,
              heading: heading,
              confidence: upd.confidence * _heading.confidence,
              source: PositionSource.fused,
              timestamp: event.timestampMs,
          );
          est = _applyMapSnap(est);
          if ((est.x - upd.x).abs() > 0.01 || (est.y - upd.y).abs() > 0.01) {
            _pdr.setPosition(est.x, est.y, headingDeg: moveHeading);
          }
          _updatePosition(est);
          _stepLog.add(StepDiagnostic(
            stepNumber: upd.stepsDetected,
            timestampMs: event.timestampMs,
            headingDeg: moveHeading,
              stride: upd.strideLength,
              dx: upd.dx,
              dy: upd.dy,
              worldX: est.x,
              worldY: est.y,
              motionState: _motion.state,
              validatorReason: vr.reason,
              source: StepSource.hardware,
              confidence: vr.confidence,
            ));
            if (_stepLog.length > 50) _stepLog.removeAt(0);
          }
        },
        onError: (Object error) {
          _stepDetectorErrorMsg = error.toString();
          _switchToFallback('hw-error');
        },
      );
      _userAccelSub = _sensorProvider!.userAcceleration.listen((reading) {
        _lastUserAccelReading = reading;
        _accelSampleCount++;
        _motion.addAcceleration(reading);
        if (_motion.isStill) _validator.notifyStill();
        if (_motion.state == MotionState.walking) {
          _walkingStreak++;
        } else {
          _walkingStreak = 0;
        }
        final failoverReason = _failoverCheck(reading);
        if (failoverReason != null) _switchToFallback(failoverReason);
        if (_fallbackActive ||
            (_walkingStreak >= _minWalkingStreak &&
                !_hardwareFresh(reading.timestampMs))) {
          _processFallbackReading(reading);
        }
        if (_calibration.isWalking) _calibration.feedAcceleration(reading);
      });
    } else {
      _userAccelSub = _sensorProvider!.userAcceleration.listen((reading) {
        _lastUserAccelReading = reading;
        _accelSampleCount++;
        _motion.addAcceleration(reading);
        _processFallbackReading(reading);
        if (_calibration.isWalking) _calibration.feedAcceleration(reading);
      });
    }
  }

  void resetPosition() {
    _pdr.reset();
    _pdr.setPosition(0, 0);
    _motion.reset();
    _validator.reset();
    _snapper.reset();
    _currentPosition = PositionEstimate(
      x: 0,
      y: 0,
      heading: 0,
      confidence: 1.0,
      source: PositionSource.fused,
      timestamp: DateTime.now().millisecondsSinceEpoch,
    );
    _hardwareStepCount = 0;
    _lastHardwareStepTime = 0;
    _stepLog.clear();
    _lastStepReason = 'RESET';
    // Fresh session retries hardware first.
    _walkingStreak = 0;
    _accelSampleCount = 0;
    _fallbackSampleCount = 0;
    _fallbackActive = false;
    _failoverReason = null;
    _stepDetectorErrorMsg = null;
    _firstWalkingTsMs = null;
    _lastAcceptedStepMs = null;
    _positionStreamController.add(_currentPosition!);
  }

  void _stopSensorListening() {
    _userAccelSub?.cancel();
    _gyroSub?.cancel();
    _magnetSub?.cancel();
    _accelSub?.cancel();
    _stepDetectorSub?.cancel();
    _sensorProvider?.stop();
  }

  void _updatePosition(PositionEstimate estimate) {
    _currentPosition = estimate;
    _positionStreamController.add(estimate);
  }

  void reset() {
    _currentPosition = null;
    _lastSentPosition = null;
    _lastSendTime = null;
    _stopSensorListening();
    _pdr.reset();
    _heading.reset();
    _calibration.reset();
    _motion.reset();
    _validator.reset();
    _snapper.reset();
    _lastStepReason = '—';
    _walkingStreak = 0;
    _accelSampleCount = 0;
    _fallbackSampleCount = 0;
    _hardwareStepCount = 0;
    _lastHardwareStepTime = 0;
    _stepLog.clear();
    _fallbackActive = false;
    _failoverReason = null;
    _stepDetectorErrorMsg = null;
    _firstWalkingTsMs = null;
    _lastAcceptedStepMs = null;
    _lastEmittedHeading = null;
  }

  void dispose() {
    _stopSensorListening();
    _positionStreamController.close();
    _headingStreamController.close();
  }
}

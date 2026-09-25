/// Fake sensor provider for unit tests.
///
/// Provides deterministic sensor data that can be controlled by the
/// test. Supports pushing custom sensor readings and simulating realistic
/// motion patterns.
library;

import 'dart:async';
import 'dart:math' as math;

import 'sensor_provider.dart';

class FakeSensorProvider implements SensorProvider {
  final _accelController = StreamController<SensorReading>.broadcast();
  final _userAccelController = StreamController<SensorReading>.broadcast();
  final _gyroController = StreamController<SensorReading>.broadcast();
  final _magnetController = StreamController<SensorReading>.broadcast();
  final _stepCounterController = StreamController<SensorReading>.broadcast();
  final _stepDetectorController = StreamController<SensorReading>.broadcast();

  int _stepCount = 0;
  bool _started = false;
  final List<StreamSubscription> _subs = [];

  // For deterministic timestamps in tests
  int _fakeTimeMs = 1000;
  int _nextTime({int deltaMs = 40}) {
    _fakeTimeMs += deltaMs;
    return _fakeTimeMs;
  }

  void setFakeTime(int t) => _fakeTimeMs = t;
  int get fakeTime => _fakeTimeMs;

  @override
  SensorCapabilities get capabilities => const SensorCapabilities(
        hasAccelerometer: true,
        hasGyroscope: true,
        hasMagnetometer: true,
        hasUserAcceleration: true,
        hasStepCounter: true,
        hasStepDetector: true,
      );

  @override
  Stream<SensorReading> get userAcceleration => _userAccelController.stream;
  @override
  Stream<SensorReading> get gyroscope => _gyroController.stream;
  @override
  Stream<SensorReading> get magnetometer => _magnetController.stream;
  @override
  Stream<SensorReading> get accelerometer => _accelController.stream;
  @override
  Stream<SensorReading> get stepCounter => _stepCounterController.stream;

  @override
  Stream<SensorReading> get stepDetector => _stepDetectorController.stream;

  @override
  void start() {
    _started = true;
  }

  @override
  void stop() {
    for (final sub in _subs) {
      sub.cancel();
    }
    _subs.clear();
    _started = false;
  }

  @override
  void dispose() {
    stop();
    _accelController.close();
    _userAccelController.close();
    _gyroController.close();
    _magnetController.close();
    _stepCounterController.close();
    _stepDetectorController.close();
  }

  void pushUserAcceleration(double x, double y, double z, {int? timestampMs}) {
    if (!_started) return;
    _userAccelController.add(SensorReading(
      x: x,
      y: y,
      z: z,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  void pushUserAccelerationAt(double x, double y, double z, int timestampMs) {
    if (!_started) return;
    _userAccelController.add(SensorReading(
        x: x, y: y, z: z, timestampMs: timestampMs));
    if (timestampMs > _fakeTimeMs) _fakeTimeMs = timestampMs;
  }

  void pushGyroscope(double x, double y, double z, {int? timestampMs}) {
    if (!_started) return;
    _gyroController.add(SensorReading(
      x: x,
      y: y,
      z: z,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  void pushMagnetometer(double x, double y, double z, {int? timestampMs}) {
    if (!_started) return;
    _magnetController.add(SensorReading(
      x: x,
      y: y,
      z: z,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  void pushAccelerometer(double x, double y, double z, {int? timestampMs}) {
    if (!_started) return;
    _accelController.add(SensorReading(
      x: x,
      y: y,
      z: z,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  void pushStep({int? timestampMs}) {
    if (!_started) return;
    _stepCount++;
    _stepCounterController.add(SensorReading(
      x: _stepCount.toDouble(),
      y: 0,
      z: 0,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  /// Hardware step detector event (one per physical step).
  void pushStepDetector({int? timestampMs}) {
    if (!_started) return;
    _stepDetectorController.add(SensorReading(
      x: 1.0,
      y: 0,
      z: 0,
      timestampMs: timestampMs ?? _nextTime(),
    ));
  }

  /// Simulates a native step-detector channel failure (e.g. sensor absent).
  /// Mirrors AndroidSensorProvider forwarding the platform error so
  /// PositioningService can fail over to fallback PDR.
  void failStepDetector([String message = 'UNAVAILABLE']) {
    if (!_started) return;
    _stepDetectorController.addError(Exception(message));
  }

  /// Legacy: alternating peaks
  void simulateWalkingSteps(int steps) {
    for (var i = 0; i < steps; i++) {
      final phase = (i % 2 == 0) ? 1.0 : -0.5;
      pushUserAcceleration(0, phase, 0);
      if (i % 2 == 0) pushStep();
    }
  }

  // ── Realistic simulations ──────────────────────────────────────────

  /// Device lying still: tiny noise around 0.
  void simulateStationary({int samples = 20, int intervalMs = 40, double noise = 0.08}) {
    final rng = math.Random(42);
    for (var i = 0; i < samples; i++) {
      final nx = (rng.nextDouble() - 0.5) * noise;
      final ny = (rng.nextDouble() - 0.5) * noise;
      final nz = (rng.nextDouble() - 0.5) * noise;
      pushUserAcceleration(nx, ny, nz);
      _fakeTimeMs += intervalMs - 40;
    }
  }

  /// Small random wobble (picking up phone, etc.) — should NOT count as steps.
  void simulateWobble({int samples = 15, int intervalMs = 40}) {
    final rng = math.Random(123);
    for (var i = 0; i < samples; i++) {
      final mag = 0.4 + rng.nextDouble() * 0.5; // 0.4-0.9, below minPeak
      final angle = rng.nextDouble() * math.pi * 2;
      pushUserAcceleration(math.cos(angle) * mag, math.sin(angle) * mag, 0);
      _fakeTimeMs += intervalMs - 40;
    }
  }

  /// Strong shaking: rapid large peaks at high frequency, irregular.
  void simulateShake({int bursts = 10, int intervalMs = 40}) {
    final rng = math.Random(999);
    for (var i = 0; i < bursts; i++) {
      // Alternate large positive/negative with varying magnitude 2.5-5.0
      final mag = 2.8 + rng.nextDouble() * 2.2;
      final sign = i.isEven ? 1 : -1;
      // Add randomness to timing: interval 60-120ms (much faster than walking)
      final dt = 60 + rng.nextInt(60);
      pushUserAcceleration(0, sign * mag, (rng.nextDouble() - 0.5) * 1.0);
      _fakeTimeMs += dt - 40;
      // Extra filler sample between bursts to make it look noisier
      if (i % 2 == 1) {
        pushUserAcceleration(
            (rng.nextDouble() - 0.5) * 2, (rng.nextDouble() - 0.5) * 2, 0);
        _fakeTimeMs += 20;
      }
    }
  }

  /// Realistic walking: periodic peaks at ~1.8 Hz with valley structure.
  /// Each step: rise (peak ~1.8-2.4), fall to valley (~0.2-0.4), repeat.
  void simulateWalk({
    required int steps,
    int stepIntervalMs = 550,
    double peakMag = 2.0,
    double valleyMag = 0.25,
    int samplesPerStep = 6,
  }) {
    final rng = math.Random(7);
    for (var s = 0; s < steps; s++) {
      final baseTime = _fakeTimeMs + s * stepIntervalMs;
      // Within each step, emit a rising then falling pattern
      for (var k = 0; k < samplesPerStep; k++) {
        double mag;
        if (k == 1 || k == 2) {
          // Peak region
          mag = peakMag + (rng.nextDouble() - 0.5) * 0.4;
        } else if (k == 4 || k == 5) {
          mag = valleyMag + rng.nextDouble() * 0.15;
        } else {
          mag = 0.6 + rng.nextDouble() * 0.3;
        }
        // Random direction but always positive magnitude direction in y for simplicity
        final t = baseTime + k * (stepIntervalMs ~/ samplesPerStep);
        pushUserAccelerationAt(0, mag, 0, t);
      }
    }
    _fakeTimeMs += steps * stepIntervalMs;
  }

  /// Walk then turn: walking steps, then a heading change, then more walking.
  void simulateWalkAndTurn({
    required int stepsBeforeTurn,
    required int stepsAfterTurn,
    double turnDegrees = 90,
  }) {
    simulateWalk(steps: stepsBeforeTurn);
    // Simulate gyro turn: ~ turnDegrees over 800ms
    final turnRad = turnDegrees * math.pi / 180.0;
    const turnDurationMs = 800;
    const gyroSamples = 8;
    final angularVel = turnRad / (turnDurationMs / 1000.0); // rad/s
    for (var i = 0; i < gyroSamples; i++) {
      pushGyroscope(0, 0, angularVel, timestampMs: _fakeTimeMs + i * 100);
    }
    _fakeTimeMs += turnDurationMs;
    // Magnetometer after turn
    final newHeading = turnDegrees;
    final rad = newHeading * math.pi / 180.0;
    pushMagnetometer(math.sin(rad), math.cos(rad), 0);
    simulateWalk(steps: stepsAfterTurn);
  }

  /// Walk out and back: should end near start.
  void simulateWalkAndReturn({required int stepsOut}) {
    simulateWalk(steps: stepsOut);
    // U-turn: 180 degrees
    final turnRad = math.pi;
    const turnDurationMs = 1000;
    final angularVel = turnRad / (turnDurationMs / 1000.0);
    for (var i = 0; i < 10; i++) {
      pushGyroscope(0, 0, angularVel, timestampMs: _fakeTimeMs + i * 100);
    }
    _fakeTimeMs += turnDurationMs;
    pushMagnetometer(0, -1, 0); // south
    simulateWalk(steps: stepsOut);
  }
}

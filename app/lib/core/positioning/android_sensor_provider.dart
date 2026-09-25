/// Android implementation of [SensorProvider] using sensors_plus
/// and a platform EventChannel for TYPE_STEP_DETECTOR.
///
/// Wraps sensors_plus for IMU + uses native step detector when available.
library;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:sensors_plus/sensors_plus.dart';

import 'sensor_provider.dart';

class AndroidSensorProvider implements SensorProvider {
  AndroidSensorProvider({this.samplingRate = 20000});

  final int samplingRate;

  final _accelerometerController = StreamController<SensorReading>.broadcast();
  final _userAccelController = StreamController<SensorReading>.broadcast();
  final _gyroController = StreamController<SensorReading>.broadcast();
  final _magnetController = StreamController<SensorReading>.broadcast();
  final _stepCounterController = StreamController<SensorReading>.broadcast();
  final _stepDetectorController = StreamController<SensorReading>.broadcast();

  StreamSubscription<UserAccelerometerEvent>? _userAccelSub;
  StreamSubscription<GyroscopeEvent>? _gyroSub;
  StreamSubscription<MagnetometerEvent>? _magnetSub;
  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<dynamic>? _stepDetectorSub;

  static const _stepDetectorChannel =
      EventChannel('com.example.real_life_amongus_app/step_detector');

  bool _started = false;
  bool _stepDetectorAvailable = true;

  /// Raw native step-detector events seen (diagnostics + liveness).
  int _stepDetectorEventCount = 0;
  int get stepDetectorEventCount => _stepDetectorEventCount;

  /// Last native step-detector error, if the channel failed.
  String? _stepDetectorError;
  String? get stepDetectorError => _stepDetectorError;

  @override
  SensorCapabilities get capabilities => SensorCapabilities(
        hasAccelerometer: true,
        hasGyroscope: true,
        hasMagnetometer: true,
        hasUserAcceleration: true,
        hasStepCounter: false,
        hasStepDetector: _stepDetectorAvailable,
      );

  @override
  Stream<SensorReading> get userAcceleration => _userAccelController.stream;
  @override
  Stream<SensorReading> get gyroscope => _gyroController.stream;
  @override
  Stream<SensorReading> get magnetometer => _magnetController.stream;
  @override
  Stream<SensorReading> get accelerometer => _accelerometerController.stream;
  @override
  Stream<SensorReading> get stepCounter => _stepCounterController.stream;
  @override
  Stream<SensorReading> get stepDetector => _stepDetectorController.stream;

  @override
  void start() {
    if (_started) return;
    _started = true;

    _accelSub = accelerometerEventStream(
      samplingPeriod: Duration(microseconds: samplingRate),
    ).listen((event) {
      _accelerometerController.add(SensorReading(
        x: event.x,
        y: event.y,
        z: event.z,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      ));
    });

    _userAccelSub = userAccelerometerEventStream(
      samplingPeriod: Duration(microseconds: samplingRate),
    ).listen((event) {
      _userAccelController.add(SensorReading(
        x: event.x,
        y: event.y,
        z: event.z,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      ));
    });

    _gyroSub = gyroscopeEventStream(
      samplingPeriod: Duration(microseconds: samplingRate),
    ).listen((event) {
      _gyroController.add(SensorReading(
        x: event.x,
        y: event.y,
        z: event.z,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      ));
    });

    _magnetSub = magnetometerEventStream(
      samplingPeriod: Duration(microseconds: samplingRate),
    ).listen((event) {
      _magnetController.add(SensorReading(
        x: event.x,
        y: event.y,
        z: event.z,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
      ));
    });

    // Try to listen to hardware step detector.
    // NOTE: a native UNAVAILABLE error arrives asynchronously, AFTER start()
    // returns. It is forwarded into the controller so PositioningService can
    // fail over to fallback PDR instead of waiting on a dead stream.
    try {
      _stepDetectorSub = _stepDetectorChannel.receiveBroadcastStream().listen(
        (dynamic event) {
          _stepDetectorEventCount++;
          final map = event as Map<dynamic, dynamic>;
          final ts = (map['timestamp'] as num?)?.toInt() ??
              DateTime.now().millisecondsSinceEpoch;
          _stepDetectorController.add(SensorReading(
            x: (map['value'] as num?)?.toDouble() ?? 1.0,
            y: 0,
            z: 0,
            timestampMs: ts,
          ));
        },
        onError: (Object error) {
          _stepDetectorAvailable = false;
          _stepDetectorError = error.toString();
          if (!_stepDetectorController.isClosed) {
            _stepDetectorController.addError(error);
          }
        },
        cancelOnError: false,
      );
    } catch (_) {
      _stepDetectorAvailable = false;
    }
  }

  @override
  void stop() {
    _userAccelSub?.cancel();
    _gyroSub?.cancel();
    _magnetSub?.cancel();
    _accelSub?.cancel();
    _stepDetectorSub?.cancel();
    _started = false;
  }

  @override
  void dispose() {
    stop();
    _accelerometerController.close();
    _userAccelController.close();
    _gyroController.close();
    _magnetController.close();
    _stepCounterController.close();
    _stepDetectorController.close();
  }
}

/// Abstract sensor provider interface for the positioning system.
///
/// Provides a platform-independent way to access device sensors.
/// On Android, this wraps sensors_plus. In tests, a fake implementation
/// provides deterministic data.
library;

/// Raw sensor reading with timestamp.
class SensorReading {
  const SensorReading({
    required this.x,
    required this.y,
    required this.z,
    required this.timestampMs,
  });

  final double x;
  final double y;
  final double z;
  final int timestampMs;

  @override
  String toString() =>
      'Sensor(${x.toStringAsFixed(3)}, ${y.toStringAsFixed(3)}, '
      '${z.toStringAsFixed(3)}, t=$timestampMs)';
}

/// Available sensor capabilities.
class SensorCapabilities {
  const SensorCapabilities({
    this.hasAccelerometer = false,
    this.hasGyroscope = false,
    this.hasMagnetometer = false,
    this.hasUserAcceleration = false,
    this.hasStepCounter = false,
    this.hasStepDetector = false,
  });

  final bool hasAccelerometer;
  final bool hasGyroscope;
  final bool hasMagnetometer;
  final bool hasUserAcceleration;
  final bool hasStepCounter;
  final bool hasStepDetector;

  @override
  String toString() =>
      'Sensors(a=$hasAccelerometer, g=$hasGyroscope, m=$hasMagnetometer, '
      'ua=$hasUserAcceleration, sc=$hasStepCounter, sd=$hasStepDetector)';
}

/// Abstract interface for accessing device sensors.
///
/// Implementations provide real sensor data (AndroidSensorProvider) or
/// fake data for testing (FakeSensorProvider).
abstract class SensorProvider {
  /// Returns the available sensor capabilities.
  SensorCapabilities get capabilities;

  /// Stream of user acceleration readings (excluding gravity).
  /// x = right, y = up, z = out of screen (device coordinates).
  Stream<SensorReading> get userAcceleration;

  /// Stream of gyroscope readings (angular velocity in rad/s).
  /// x = roll, y = pitch, z = yaw.
  Stream<SensorReading> get gyroscope;

  /// Stream of magnetometer readings (microtesla).
  /// x, y, z in device coordinates.
  Stream<SensorReading> get magnetometer;

  /// Stream of accelerometer readings (including gravity, m/s²).
  Stream<SensorReading> get accelerometer;

  /// Stream of step counter events (monotonically increasing).
  Stream<SensorReading> get stepCounter;

  /// Stream of hardware step detector events (1 per physical step).
  Stream<SensorReading> get stepDetector;

  /// Start listening to sensors. Must be called before accessing streams.
  void start();

  /// Stop listening to sensors.
  void stop();

  /// Release all resources.
  void dispose();
}

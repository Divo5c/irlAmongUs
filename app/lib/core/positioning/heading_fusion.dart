/// Heading fusion using magnetometer + gyroscope for smooth orientation.
///
/// Fuses magnetometer (absolute heading from magnetic north) with
/// gyroscope (relative angular velocity) using a complementary filter.
/// The gyroscope provides fast response, the magnetometer corrects drift.
library;

import 'dart:math' as math;

/// Fused heading output with confidence.
class FusedHeading {
  const FusedHeading({
    required this.headingDeg,
    required this.confidence,
  });

  /// Heading in degrees (0–360), 0 = north.
  final double headingDeg;

  /// Confidence 0.0–1.0 (1.0 = reliable).
  final double confidence;

  @override
  String toString() =>
      'Heading(${headingDeg.toStringAsFixed(1)}°, c=${confidence.toStringAsFixed(2)})';
}

/// Complementary filter for heading fusion.
///
/// Combines gyroscope integration (fast, drifts) with magnetometer
/// (absolute, noisy) using a weighted blend.
class HeadingFusion {
  HeadingFusion({
    this.alpha = 0.98,
    this.magnetDeclination = 0,
  });

  /// Filter coefficient. Higher = trust gyroscope more.
  /// 0.98 = mostly gyroscope with slow magnetometer correction.
  final double alpha;

  /// Magnetic declination for the local area (degrees).
  final double magnetDeclination;

  double _integratedHeading = 0;
  double? _lastGyroTimestamp;
  bool _initialized = false;
  double _confidence = 0.5;

  /// Last computed heading, or null if not initialized.
  FusedHeading? get currentHeading => _initialized
      ? FusedHeading(headingDeg: _integratedHeading, confidence: _confidence)
      : null;

  /// Confidence level based on magnetometer reliability.
  double get confidence => _confidence;

  /// Resets the filter state.
  void reset() {
    _integratedHeading = 0;
    _lastGyroTimestamp = null;
    _initialized = false;
    _confidence = 0.5;
  }

  /// Updates heading from gyroscope angular velocity (rad/s).
  ///
  /// Sign: for the flat device frame this class assumes, rigid-body
  /// kinematics give compass rate Ω = −ωz (a physical right turn yields
  /// negative z-rate but must increase the clockwise compass heading).
  /// Hence the negation — without it the fused heading (and arrow/PDR)
  /// would rotate mirrored to the real turn.
  void updateFromGyroscope(double angularVelocityZ, int timestampMs) {
    if (_lastGyroTimestamp != null && _initialized) {
      final dtMs = timestampMs - _lastGyroTimestamp!;
      if (dtMs > 0 && dtMs < 2000) {
        final dHeading = -angularVelocityZ * (dtMs / 1000.0);
        _lastGyroDeltaDeg = dHeading * 180.0 / math.pi;
        var newHeading = _integratedHeading + _lastGyroDeltaDeg;
        newHeading = newHeading % 360;
        if (newHeading < 0) newHeading += 360;
        _integratedHeading = newHeading;
      } else {
        _lastGyroDeltaDeg = 0;
      }
    } else {
      _lastGyroDeltaDeg = 0;
    }
    _lastGyroTimestamp = timestampMs.toDouble();
  }

  double _lastMagHeading = 0;
  int _lastMagTimeMs = 0;
  bool _hasLastMag = false;

  /// Updates heading from magnetometer readings.
  void updateFromMagnetometer(double mx, double my, int timestampMs, [double mz = 0]) {
    _lastMx = mx;
    _lastMy = my;
    _lastMz = mz;
    var magHeading = math.atan2(mx, my) * 180.0 / math.pi;
    if (magHeading < 0) magHeading += 360;
    magHeading = (magHeading + magnetDeclination) % 360;
    if (magHeading < 0) magHeading += 360;
    _lastRawMagHeading = magHeading;

    if (!_initialized) {
      _integratedHeading = magHeading;
      _initialized = true;
      _confidence = 0.7;
      _lastMagHeading = magHeading;
      _lastMagTimeMs = timestampMs;
      _hasLastMag = true;
      return;
    }

    // Indoor magnetic interference gate: sudden large jumps (>50°) in
    // <800ms are likely interference (metal, speakers) — dampen heavily.
    double effectiveAlpha = alpha;
    if (_hasLastMag) {
      final dt = timestampMs - _lastMagTimeMs;
      if (dt > 0 && dt < 800) {
        var jump = (magHeading - _lastMagHeading).abs();
        if (jump > 180) jump = 360 - jump;
        if (jump > 50) {
          // Strong damping for outlier
          effectiveAlpha = 0.995;
        } else if (jump > 30) {
          effectiveAlpha = 0.985;
        }
      }
    }
    _lastMagHeading = magHeading;
    _lastMagTimeMs = timestampMs;
    _hasLastMag = true;

    var diff = magHeading - _integratedHeading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    var newHeading = _integratedHeading + (1 - effectiveAlpha) * diff;
    newHeading = newHeading % 360;
    if (newHeading < 0) newHeading += 360;
    _integratedHeading = newHeading;

    _confidence = (1.0 - diff.abs() / 180.0).clamp(0.3, 1.0);
  }

  /// Returns the current heading in degrees (0–360).
  double? get headingDeg => _initialized ? _integratedHeading : null;

  // Diagnostics
  double get lastMagHeadingValue => _lastMagHeading;
  int get lastMagTime => _lastMagTimeMs;
  bool get isInitialized => _initialized;
  double? get lastGyroTimestamp => _lastGyroTimestamp;
  double get lastIntegratedHeading => _integratedHeading;
  double _lastGyroDeltaDeg = 0;
  double get lastGyroDeltaDeg => _lastGyroDeltaDeg;
  double _lastMx = 0, _lastMy = 0, _lastMz = 0;
  double get lastMx => _lastMx;
  double get lastMy => _lastMy;
  double get lastMz => _lastMz;
  double _lastRawMagHeading = 0;
  double get lastRawMagHeading => _lastRawMagHeading;
}

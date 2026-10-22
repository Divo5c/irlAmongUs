/// GPS position provider interface.
///
/// Outdoors, GPS is the primary positioning technology: direct, metric and
/// drift-free. The provider streams raw fixes; PositioningService converts
/// them into world coordinates and applies its own quality gates
/// (accuracy threshold + freeze-on-loss).
library;

import 'dart:async';

import 'package:geolocator/geolocator.dart' as geo;

/// One GPS fix.
class GpsFix {
  const GpsFix({
    required this.lat,
    required this.lon,
    required this.accuracyM,
    required this.timestampMs,
    this.headingDeg,
    this.speedMps,
  });

  final double lat;
  final double lon;

  /// Horizontal accuracy radius in meters (per platform semantics).
  final double accuracyM;

  /// Course over ground in degrees (0 = north, clockwise), null when
  /// stationary or unknown.
  final double? headingDeg;

  final double? speedMps;
  final int timestampMs;

  bool get hasUsableAccuracy => accuracyM.isFinite && accuracyM > 0;
}

/// Quality gate before a fix is trusted.
class GpsQualityPolicy {
  const GpsQualityPolicy({this.maxAccuracyM = 15.0, this.freezeAfterMs = 4000});

  /// Fixes worse than this accuracy are ignored (position freezes instead).
  final double maxAccuracyM;

  /// A fix older than this relative to the last accepted one is treated as
  /// GPS loss (position freezes).
  final int freezeAfterMs;
}

/// Abstract interface so tests can substitute a fake provider.
abstract class GpsProvider {
  Stream<GpsFix> get fixes;

  /// Resolves to true when GPS can realistically start (permission granted
  /// AND location service enabled). Implementations may request permission
  /// on the way.
  Future<bool> isReady();

  /// One-shot position hint without waiting for a high quality stream fix.
  /// Uses the last known / network position, so it also works indoors.
  /// Returns null when no position is available at all.
  Future<GpsFix?> quickFix();

  void start();
  void stop();
  void dispose();
}

/// Real provider (Android/iOS) via the geolocator package.
/// Tests use [FakeGpsProvider] instead.
class AndroidGpsProvider implements GpsProvider {
  /// When true, the accuracy gate is raised (map fetching /
  /// geocoding use cases, e.g. OSM street loading indoors).
  AndroidGpsProvider({GpsQualityPolicy? policy, this.coarse = false})
    : _policy = policy ?? const GpsQualityPolicy();

  final GpsQualityPolicy _policy;
  final bool coarse;
  StreamSubscription<geo.Position>? _sub;
  final _controller = StreamController<GpsFix>.broadcast();

  /// Effective accuracy ceiling; [coarse] accepts network fixes (20-200 m).
  double get _maxAccuracyM => coarse
      ? (_policy.maxAccuracyM * 20).clamp(200.0, 2000.0).toDouble()
      : _policy.maxAccuracyM;

  @override
  Stream<GpsFix> get fixes => _controller.stream;

  @override
  Future<bool> isReady() async {
    final serviceEnabled = await geo.Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return false;
    var permission = await geo.Geolocator.checkPermission();
    if (permission == geo.LocationPermission.deniedForever) return false;
    if (permission == geo.LocationPermission.denied) {
      permission = await geo.Geolocator.requestPermission();
    }
    return permission == geo.LocationPermission.whileInUse ||
        permission == geo.LocationPermission.always;
  }

  @override
  Future<GpsFix?> quickFix() async {
    try {
      geo.Position? position = await geo.Geolocator.getLastKnownPosition();
      position ??= await geo.Geolocator.getCurrentPosition(
        locationSettings: const geo.LocationSettings(
          accuracy: geo.LocationAccuracy.medium,
          timeLimit: Duration(seconds: 12),
        ),
      );
      final fix = GpsFix(
        lat: position.latitude,
        lon: position.longitude,
        accuracyM: position.accuracy,
        timestampMs: position.timestamp.millisecondsSinceEpoch,
      );
      return fix;
    } catch (_) {
      return null;
    }
  }

  @override
  void start() {
    if (_sub != null) return;
    final settings = geo.LocationSettings(
      accuracy: geo.LocationAccuracy.best,
      distanceFilter: 1,
      timeLimit: null,
    );
    _sub = geo.Geolocator.getPositionStream(locationSettings: settings).listen(
      (position) {
        final fix = GpsFix(
          lat: position.latitude,
          lon: position.longitude,
          accuracyM: position.accuracy,
          headingDeg: _heading(position),
          speedMps: position.speed.isFinite && position.speed > 0
              ? position.speed
              : null,
          timestampMs: position.timestamp.millisecondsSinceEpoch,
        );
        if (!fix.hasUsableAccuracy || fix.accuracyM > _maxAccuracyM) {
          return; // too inaccurate — the service freezes instead of jumping
        }
        _controller.add(fix);
      },
      onError: (Object _) {
        // GPS errors are non-fatal: the pipeline freezes until fixes return.
      },
    );
  }

  double? _heading(geo.Position position) {
    final h = position.heading;
    return h.isFinite && h >= 0 ? h : null;
  }

  @override
  void stop() {
    _sub?.cancel();
    _sub = null;
  }

  @override
  void dispose() {
    stop();
    _controller.close();
  }
}

/// Fake provider for tests: push [GpsFix]es manually.
class FakeGpsProvider implements GpsProvider {
  final _controller = StreamController<GpsFix>.broadcast();
  var _ready = true;

  /// Optional fix returned by [quickFix]; null means "no position".
  GpsFix? fakeQuickFix;

  @override
  Stream<GpsFix> get fixes => _controller.stream;

  @override
  Future<bool> isReady() async => _ready;

  @override
  Future<GpsFix?> quickFix() async => fakeQuickFix;

  set ready(bool value) => _ready = value;

  void emit(GpsFix fix) => _controller.add(fix);

  void emitError(Object error) => _controller.addError(error);

  @override
  void start() {}

  @override
  void stop() {}

  @override
  void dispose() => _controller.close();
}

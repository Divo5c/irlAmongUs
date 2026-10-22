import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/positioning/gps_projector.dart';
import 'package:real_life_amongus_app/core/positioning/gps_provider.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';

void main() {
  Future<void> flushEvents() async {
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
  }

  group('GeoProjector', () {
    test('anchors the origin fix at (0, 0)', () {
      const lat0 = 51.2277, lon0 = 6.7735; // Düsseldorf ballpark
      final projector = GeoProjector.anchoredAt(lat0, lon0);
      final (x, y) = projector.project(lat0, lon0);
      expect(x, closeTo(0, 1e-9));
      expect(y, closeTo(0, 1e-9));
    });

    test('one degree of latitude is about 111 km north (Y negative)', () {
      final projector = GeoProjector.anchoredAt(51.0, 6.0);
      final (x, y) = projector.project(51.0 + 1 / 111320 * 111320, 6.0);
      // 1 degree lat ≈ 111.32 km; north → -Y
      expect(y, lessThan(0));
      expect(y.abs(), closeTo(111320, 1500));
      expect(x, closeTo(0, 1));
    });

    test('walking north keeps X stable and decreases Y', () {
      final projector = GeoProjector.anchoredAt(51.0, 6.0);
      // ~10 m north: ~0.0000899 degrees latitude
      final (x1, y0) = projector.project(51.0, 6.0);
      final (x2, y2) = projector.project(51.0 + 0.0000899, 6.0);
      expect(x2 - x1, closeTo(0, 0.5));
      expect(y2 - y0, closeTo(-10, 0.5));
    });

    test('walking east increases X', () {
      final projector = GeoProjector.anchoredAt(51.0, 6.0);
      final (x0, _) = projector.project(51.0, 6.0);
      // ~10 m east at lat 51: ~0.0001431 degrees longitude
      final (x2, _) = projector.project(51.0, 6.0 + 0.0001431);
      expect(x2 - x0, closeTo(10, 0.5));
    });
  });

  group('PositioningService GPS mode', () {
    GpsFix fix(
      double lat,
      double lon, {
      double accuracy = 5,
      int timestamp = 1000,
      double? heading = 90,
    }) =>
        GpsFix(
          lat: lat,
          lon: lon,
          accuracyM: accuracy,
          headingDeg: heading,
          speedMps: null,
          timestampMs: timestamp,
        );

    test('refuses to enable without permission/location service', () async {
      final gps = FakeGpsProvider()..ready = false;
      final service = PositioningService();
      final ok = await service.enableGpsMode(provider: gps);
      expect(ok, isFalse);
      expect(service.isGpsMode, isFalse);
    });

    test('first fix anchors the origin; later fixes are relative', () async {
      final gps = FakeGpsProvider();
      final service = PositioningService();
      expect(await service.enableGpsMode(provider: gps), isTrue);

      final positions = <PositionEstimate>[];
      service.positionStream.listen(positions.add);

      gps.emit(fix(51.0, 6.0));
      gps.emit(fix(51.0 + 0.0000899, 6.0)); // ~10 m north
      await flushEvents();

      expect(positions, hasLength(2));
      expect(positions[0].x, closeTo(0, 0.01));
      expect(positions[0].y, closeTo(0, 0.01));
      // North → -Y:
      expect(positions[1].y, closeTo(-10, 0.5));
      expect(positions[1].source, PositionSource.gps);
      expect(positions[1].heading, closeTo(90, 0.01));
    });

    test('weak accuracy fixes are rejected and the position freezes', () async {
      final gps = FakeGpsProvider();
      final service = PositioningService();
      await service.enableGpsMode(
        provider: gps,
        policy: const GpsQualityPolicy(maxAccuracyM: 15),
      );

      PositionEstimate? last;
      service.positionStream.listen((p) => last = p);

      gps.emit(fix(51.0, 6.0));
      gps.emit(fix(51.0005, 6.0, accuracy: 40)); // way too weak
      await flushEvents();

      expect(service.gpsRejectedCount, 1);
      expect(last!.y, closeTo(0, 0.01)); // frozen at origin
    });

    test('disabling stops consuming fixes', () async {
      final gps = FakeGpsProvider();
      final service = PositioningService();
      await service.enableGpsMode(provider: gps);

      var count = 0;
      service.positionStream.listen((_) => count++);
      gps.emit(fix(51.0, 6.0));
      await flushEvents();
      service.disableGpsMode();
      gps.emit(fix(51.001, 6.0));
      await flushEvents();

      expect(count, 1);
    });
  });
}

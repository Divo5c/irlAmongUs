import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/positioning/fake_sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/gps_projector.dart';
import 'package:real_life_amongus_app/core/positioning/gps_provider.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_canvas.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_setup_screen.dart';

import 'widget_test.dart';

void main() {
  group('Map setup: GPS walk mode', () {
    late FakeSensorProvider fake;
    late PositioningService svc;
    late FakeGpsProvider fakeGps;

    setUp(() {
      fake = FakeSensorProvider();
      fake.start();
      fakeGps = FakeGpsProvider();
      svc = PositioningService(sensorProvider: fake);
    });

    tearDown(() {
      svc.dispose();
      fake.dispose();
      fakeGps.dispose();
    });

    Future<void> pumpEditor(WidgetTester tester) async {
      final client = FakeRoomSocketClient();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MapSetupScreen(
              socketClient: client,
              roomCode: 'ABC234',
              map: null,
              positioningService: svc,
              gpsProviderFactory: () => fakeGps,
            ),
          ),
        ),
      );
      await tester.pump();
    }

    MapCanvas canvasOf(WidgetTester tester) =>
        tester.widget<MapCanvas>(find.byKey(const Key('map-canvas')));

    testWidgets('walk mode shows record, width slider and disabled build',
        (tester) async {
      await pumpEditor(tester);

      await tester.tap(find.byKey(const Key('more-modes-button')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Walk'));
      await tester.pump();

      expect(find.byKey(const Key('record-trace-button')), findsOneWidget);
      expect(find.byKey(const Key('trace-width-slider')), findsOneWidget);
      expect(find.text('Street width'), findsOneWidget);
      expect(find.byKey(const Key('build-trace-button')), findsOneWidget);
      // Build disabled before any recording:
      final build =
          tester.widget<FilledButton>(find.byKey(const Key('build-trace-button')));
      expect(build.onPressed, isNull);
      expect(find.byKey(const Key('add-point-button')), findsNothing);
    });

    testWidgets('recording GPS fixes builds corridors after Build',
        (tester) async {
      await pumpEditor(tester);
      await tester.tap(find.byKey(const Key('more-modes-button')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Walk'));
      await tester.pump();

      await tester.tap(find.byKey(const Key('record-trace-button')));
      await tester.pump();

      const lat0 = 51.0, lon0 = 6.0;
      final projector = GeoProjector.anchoredAt(lat0, lon0);
      // ~10 m north walk in 3 fixes:
      fakeGps.emit(GpsFix(
        lat: lat0,
        lon: lon0,
        accuracyM: 4,
        timestampMs: 1000,
      ));
      fakeGps.emit(GpsFix(
        lat: lat0 + 0.0000899,
        lon: lon0,
        accuracyM: 4,
        timestampMs: 2000,
      ));
      fakeGps.emit(GpsFix(
        lat: lat0 + 0.0001798,
        lon: lon0,
        accuracyM: 4,
        timestampMs: 3000,
      ));
      await tester.pumpAndSettle();

      final canvas = canvasOf(tester);
      expect(canvas.tracePoints, hasLength(3));
      final (x0, y0) = projector.project(lat0, lon0);
      expect(canvas.tracePoints.first, Offset(x0, y0)); // anchored origin

      await tester.tap(find.byKey(const Key('record-trace-button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('build-trace-button')));
      await tester.pump();

      final built = canvasOf(tester);
      expect(built.map.corridors, hasLength(1));
      expect(built.map.nodes, hasLength(2));
      // Trace is cleared after building:
      expect(built.tracePoints, isEmpty);
    });
  });
}

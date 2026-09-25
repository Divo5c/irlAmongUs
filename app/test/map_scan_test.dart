import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';
import 'package:real_life_amongus_app/core/positioning/fake_sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_canvas.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_setup_screen.dart';

import 'widget_test.dart';

void main() {
  group('Map scan: RESET, still, + Point', () {
    late FakeSensorProvider fake;
    late PositioningService svc;

    setUp(() {
      fake = FakeSensorProvider();
      svc = PositioningService(sensorProvider: fake);
      fake.start();
    });

    tearDown(() {
      svc.dispose();
      fake.dispose();
    });

    Future<void> pumpEditor(WidgetTester tester) async {
      final client = FakeRoomSocketClient();
      // Scaffold mirrors production (GameScreen), required for SnackBars.
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MapSetupScreen(
              socketClient: client,
              roomCode: 'ABC234',
              map: null,
              positioningService: svc,
            ),
          ),
        ),
      );
      await tester.pump();
    }

    MapCanvas canvasOf(WidgetTester tester) =>
        tester.widget<MapCanvas>(find.byKey(const Key('map-canvas')));

    Future<void> tapPoint(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('add-point-button')));
      await tester.pump();
    }

    testWidgets('RESET, still, one +Point stores exactly (0,0)',
        (tester) async {
      svc.resetPosition(); // RESET -> Position (0,0)
      await pumpEditor(tester);

      await tapPoint(tester);

      final canvas = canvasOf(tester);
      // The stored point must be the real PDR position, nothing synthetic.
      expect(canvas.hostPosition, const Offset(0, 0));
      expect(canvas.pendingPoints, const [Offset(0, 0)]);
      // A single point forms no corridor yet.
      expect(canvas.map.nodes, isEmpty);
      expect(canvas.map.corridors, isEmpty);
    });

    testWidgets('standing still fabricates no phantom corridor', (tester) async {
      // Fresh service, no steps validated: there is no known position yet.
      // (After the fix, scan start publishes (0,0); either way no 60m jump.)
      await pumpEditor(tester);

      await tapPoint(tester);
      await tapPoint(tester);

      final canvas = canvasOf(tester);
      // No corridor may span a distance the host never walked.
      expect(canvas.map.corridors, isEmpty);
      for (final node in canvas.map.nodes) {
        expect(node.x.abs() + node.y.abs(), lessThan(1.0));
      }
    });

    testWidgets('sensors active but position unknown stores nothing',
        (tester) async {
      await pumpEditor(tester);
      // Simulate position loss (e.g. service reset while editor is open).
      svc.reset();
      await tester.pump();

      await tapPoint(tester);
      // Let the snackbar entrance animation settle.
      await tester.pump(const Duration(milliseconds: 500));

      final canvas = canvasOf(tester);
      expect(canvas.pendingPoints, isEmpty);
      expect(canvas.map.nodes, isEmpty);
      expect(canvas.map.corridors, isEmpty);
      expect(find.textContaining('Waiting for position'), findsOneWidget);
    });

    testWidgets('arrow heading follows service heading, visible at origin',
        (tester) async {
      svc.resetPosition(); // Position (0,0), heading 0
      await pumpEditor(tester);

      var canvas = canvasOf(tester);
      expect(canvas.hostPosition, const Offset(0, 0));
      expect(canvas.hostHeadingDeg, 0.0);
      // RESET alone creates no geometry at all.
      expect(canvas.pendingPoints, isEmpty);
      expect(canvas.map.nodes, isEmpty);
      expect(canvas.map.corridors, isEmpty);

      // Host turns east without moving: arrow heading follows.
      svc.updateSensorPosition(
        x: 0,
        y: 0,
        heading: 90,
        confidence: 0.9,
        source: PositionSource.fused,
      );
      // Two pumps: one flushes the position stream, one rebuilds.
      await tester.pump();
      await tester.pump();

      canvas = canvasOf(tester);
      expect(canvas.hostPosition, const Offset(0, 0));
      expect(canvas.hostHeadingDeg, 90.0);
      expect(canvas.map.nodes, isEmpty);
      expect(canvas.map.corridors, isEmpty);
    });

    testWidgets('arrow rotates in place without moving position',
        (tester) async {
      svc.resetPosition();
      await pumpEditor(tester);

      var canvas = canvasOf(tester);
      expect(canvas.hostPosition, const Offset(0, 0));
      expect(canvas.hostHeadingDeg, 0.0);

      // Face north, then spin yaw in place (no steps, no hw events).
      fake.pushMagnetometer(0, 1, 0);
      await tester.pump();
      for (var i = 0; i < 12; i++) {
        fake.pushGyroscope(0, 0, 2.0);
        await tester.pump();
      }
      await tester.pump();

      // Arrow followed the live heading (CCW spin -> compass decreases).
      canvas = canvasOf(tester);
      expect(canvas.hostHeadingDeg!, closeTo(360 - 50.4, 8));
      // ... while position and geometry stayed frozen.
      expect(canvas.hostPosition, const Offset(0, 0));
      expect(canvas.pendingPoints, isEmpty);
      expect(canvas.map.nodes, isEmpty);
      expect(canvas.map.corridors, isEmpty);
      expect(svc.sensorStatus.totalDistance, 0);
    });

    testWidgets('walked +Point commits exact coords and connects nodes',
        (tester) async {
      svc.resetPosition();
      await pumpEditor(tester);

      await tapPoint(tester); // stores (0,0)

      // Host walked 5m east; position update arrives via PDR pipeline.
      svc.updateSensorPosition(
        x: 5,
        y: 0,
        heading: 90,
        confidence: 0.9,
        source: PositionSource.fused,
      );
      await tester.pump();
      await tapPoint(tester);

      final canvas = canvasOf(tester);
      expect(canvas.pendingPoints, const [Offset(0, 0), Offset(5, 0)]);
      expect(canvas.map.nodes.length, 2);
      expect(canvas.map.nodes[0].x, 0);
      expect(canvas.map.nodes[0].y, 0);
      expect(canvas.map.nodes[1].x, 5);
      expect(canvas.map.nodes[1].y, 0);
      expect(canvas.map.corridors.length, 1);
      final corridor = canvas.map.corridors.single;
      final a = canvas.map.nodeById(corridor.a);
      final b = canvas.map.nodeById(corridor.b);
      expect(a, isNotNull);
      expect(b, isNotNull);
      expect((a!.x, a.y), (0, 0));
      expect((b!.x, b.y), (5, 0));
    });
  });
}

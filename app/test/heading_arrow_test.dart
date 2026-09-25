import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';
import 'package:real_life_amongus_app/features/map/presentation/heading_arrow.dart';
import 'package:real_life_amongus_app/shared/widgets/diagnostics_panel.dart';

void main() {
  group('headingDirection (PDR convention)', () {
    test('0 deg points north (up, -Y)', () {
      final dir = headingDirection(0);
      expect(dir.dx, closeTo(0, 1e-9));
      expect(dir.dy, closeTo(-1, 1e-9));
    });

    test('90 deg points east (right, +X)', () {
      final dir = headingDirection(90);
      expect(dir.dx, closeTo(1, 1e-9));
      expect(dir.dy, closeTo(0, 1e-9));
    });

    test('180 deg points south, 270 deg points west', () {
      final south = headingDirection(180);
      expect(south.dx, closeTo(0, 1e-9));
      expect(south.dy, closeTo(1, 1e-9));
      final west = headingDirection(270);
      expect(west.dx, closeTo(-1, 1e-9));
      expect(west.dy, closeTo(0, 1e-9));
    });

    test('direction is a unit vector', () {
      for (final h in [0.0, 30.0, 90.0, 137.0, 180.0, 270.0, 359.0]) {
        final dir = headingDirection(h);
        expect(dir.distance, closeTo(1, 1e-9));
      }
    });
  });

  group('headingArrowTip', () {
    test('tip sits along the heading from the center', () {
      const center = Offset(10, 20);
      final north = headingArrowTip(center, 0, 16);
      expect(north.dx, closeTo(10, 1e-9));
      expect(north.dy, closeTo(20 - 16, 1e-9));
      final east = headingArrowTip(center, 90, 16);
      expect(east.dx, closeTo(10 + 16, 1e-9));
      expect(east.dy, closeTo(20, 1e-9));
    });

    test('tip rotates correctly at 180 and 270 deg', () {
      const center = Offset(10, 20);
      final south = headingArrowTip(center, 180, 16);
      expect(south.dx, closeTo(10, 1e-9));
      expect(south.dy, closeTo(20 + 16, 1e-9));
      final west = headingArrowTip(center, 270, 16);
      expect(west.dx, closeTo(10 - 16, 1e-9));
      expect(west.dy, closeTo(20, 1e-9));
    });
  });

  group('headingArrowHead', () {
    test('wings are symmetric behind the tip', () {
      const tip = Offset(0, -10);
      final head = headingArrowHead(tip, 0, 5, 8);
      // Midpoint of the wings lies on the shaft, 5 behind the tip.
      final mid = Offset(
        (head.left.dx + head.right.dx) / 2,
        (head.left.dy + head.right.dy) / 2,
      );
      expect(mid.dx, closeTo(0, 1e-9));
      expect(mid.dy, closeTo(-5, 1e-9));
      // Equal wing lengths, 8 apart.
      expect((head.left - tip).distance, closeTo((head.right - tip).distance, 1e-9));
      expect((head.left - head.right).distance, closeTo(8, 1e-9));
      // Wings are perpendicular to the shaft.
      final shaft = tip - mid;
      final span = head.left - head.right;
      expect(shaft.dx * span.dx + shaft.dy * span.dy, closeTo(0, 1e-9));
    });
  });

  group('paintHeadingArrow', () {
    test('paints without crashing for cardinal headings', () {
      for (final h in [0.0, 90.0, 180.0, 270.0]) {
        final recorder = PictureRecorder();
        final canvas = Canvas(recorder);
        paintHeadingArrow(
          canvas,
          center: const Offset(0, 0),
          headingDeg: h,
          color: const Color(0xFF000000),
        );
        recorder.endRecording();
      }
    });
  });

  group('diagnostics ARROW rows', () {
    testWidgets('shows heading, position and direction', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DiagnosticsPanel(
                currentPosition: PositionEstimate(
                  x: 3,
                  y: 4,
                  heading: 90,
                  timestamp: 0,
                ),
                gameMap: null,
                sensorStatus: null,
                stepLog: const [],
                onCalibrate: null,
                onResetPosition: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.textContaining('ARROW'), findsWidgets);
      expect(find.textContaining('heading=90°'), findsOneWidget);
      expect(find.textContaining('position=(3.0,4.0)'), findsOneWidget);
      expect(find.textContaining('dx=1.00 dy=0.00'), findsOneWidget);
    });
  });
}

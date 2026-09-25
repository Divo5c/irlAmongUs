import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_canvas.dart';

void main() {
  group('map world bounds', () {
    test('empty content has no bounds', () {
      expect(
        computeMapContentBounds(
          map: GameMapData.empty(),
          pendingPoints: const [],
          hostPosition: null,
        ),
        isNull,
      );
    });

    test('bounds cover nodes, rooms, pending points and host', () {
      final map = GameMapData(
        version: 1,
        nodes: const [
          MapNode(id: 'n1', x: 0, y: 0),
          MapNode(id: 'n2', x: 60, y: 0),
        ],
        corridors: const [],
        rooms: [
          MapRoom(
            id: 'r1',
            name: 'R',
            type: 'NORMAL',
            polygon: const [(100.0, 50.0)],
          ),
        ],
        connections: const [],
      );
      final bounds = computeMapContentBounds(
        map: map,
        pendingPoints: const [Offset(10, -5)],
        hostPosition: const Offset(-2, 3),
      )!;
      expect((bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
          (-2.0, -5.0, 100.0, 50.0));
    });
  });

  group('map canvas origin', () {
    test('centers content on the canvas', () {
      // World (0,0)-(60,0) on a 640x400 canvas at 8px/m:
      // content spans 480px, so world x=0 lands at 320-240=80.
      final origin = mapCanvasOrigin(
        bounds: (minX: 0, minY: 0, maxX: 60, maxY: 0),
        canvasSize: const Size(640, 400),
        pixelsPerMeter: 8,
      );
      expect(origin, const Offset(80, 200));
    });

    test('single point maps to canvas center', () {
      final origin = mapCanvasOrigin(
        bounds: (minX: 3, minY: 4, maxX: 3, maxY: 4),
        canvasSize: const Size(400, 300),
        pixelsPerMeter: 8,
      );
      expect(origin, const Offset(176, 118));
    });

    test('no content centers world origin', () {
      final origin = mapCanvasOrigin(
        bounds: null,
        canvasSize: const Size(400, 300),
        pixelsPerMeter: 8,
      );
      expect(origin, const Offset(200, 150));
    });
  });

  group('worldFromCanvasPoint', () {
    test('inverts the painter mapping canvas = origin + world * ppm', () {
      const origin = Offset(80, 200);
      const ppm = 8.0;
      for (final world in [
        Offset(0, 0),
        Offset(60, 0),
        Offset(-2.5, 3.75),
        Offset(0, -5),
      ]) {
        final canvasPoint = Offset(
          origin.dx + world.dx * ppm,
          origin.dy + world.dy * ppm,
        );
        final back = worldFromCanvasPoint(canvasPoint, origin, ppm);
        expect(back.dx, closeTo(world.dx, 1e-9));
        expect(back.dy, closeTo(world.dy, 1e-9));
      }
    });
  });
}

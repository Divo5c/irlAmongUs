import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/positioning/trace_to_map.dart';

List<(double, double)> line(double from, double to, double step) => [
      for (var x = from; x <= to + 1e-9; x += step) (x, 0),
    ];

void main() {
  group('simplifyPolyline', () {
    test('keeps straight lines to just two points', () {
      final pts = line(0, 10, 0.5); // 21 collinear points
      final simplified = simplifyPolyline(pts);
      expect(simplified, hasLength(2));
    });

    test('keeps corners', () {
      final pts = <(double, double)>[
        for (var x = 0.0; x <= 10.0; x += 0.5) (x, 0),
        for (var y = 0.5; y <= 10.0; y += 0.5) (10, y),
      ];
      final simplified = simplifyPolyline(pts, epsilon: 0.8);
      expect(simplified, contains((0.0, 0.0)));
      expect(simplified, contains((10.0, 10.0)));
      // The corner point itself must survive:
      expect(simplified.any((p) => p.$1 == 10.0 && p.$2 == 0.0), isTrue);
      expect(simplified.length, lessThan(pts.length));
    });

    test('returns short traces unchanged', () {
      final pts = [(0.0, 0.0), (1.0, 1.0)];
      expect(simplifyPolyline(pts), pts);
    });
  });

  group('buildMapFromTrace', () {
    test('creates nodes and corridors along a straight walk', () {
      final trace = [
        (0.0, 0.0),
        (5.0, 0.0),
        (10.0, 0.0),
        (15.0, 0.0),
        (20.0, 0.0),
      ];
      final result = buildMapFromTrace(trace, base: GameMapData.empty(), nodeSeq: 1);

      expect(result.map.nodes, hasLength(2)); // endpoints only (straight)
      expect(result.map.corridors, hasLength(1));
      final a = result.map.nodeById(result.map.corridors.first.a)!;
      final b = result.map.nodeById(result.map.corridors.first.b)!;
      expect((a.x, a.y), (0.0, 0.0));
      expect((b.x, b.y), (20.0, 0.0));
    });

    test('merges trace endpoints onto existing network nodes', () {
      final base = GameMapData(
        version: 1,
        nodes: const [
          MapNode(id: 'n1', x: 0, y: 0),
          MapNode(id: 'n2', x: 20, y: 0),
          MapNode(id: 'n3', x: 20, y: 30), // crossing point at trace end
        ],
        corridors: const [
          MapCorridor(id: 'c1', a: 'n1', b: 'n2'),
        ],
        rooms: const [
          MapRoom(
            id: 'r1',
            name: 'Cafeteria',
            type: 'CAFETERIA',
            polygon: [(30.0, 30.0), (40.0, 30.0), (40.0, 40.0), (30.0, 40.0)],
          ),
        ],
        connections: const [(roomId: 'r1', nodeId: 'n3')],
      );

      final trace = [
        (0.5, 0.0), // snaps onto n1
        (20.2, 29.8), // walks towards n3 and snaps onto it
      ];
      final result = buildMapFromTrace(
        trace,
        base: base,
        nodeSeq: 4,
        mergeRadius: 1.5,
      );

      expect(result.map.corridors, hasLength(2));
      final newCorridor = result.map.corridors.last;
      expect(newCorridor.a, 'n1');
      expect(newCorridor.b, 'n3');
      // Rooms and connections preserved:
      expect(result.map.rooms, hasLength(1));
      expect(result.map.connections, hasLength(1));
      // No new nodes were created (both snapped):
      expect(result.map.nodes, hasLength(3));
    });

    test('does not create duplicate corridors when retracing a line', () {
      final trace1 = [(0.0, 0.0), (10.0, 0.0)];
      final first = buildMapFromTrace(trace1, base: GameMapData.empty(), nodeSeq: 1);

      final trace2 = [(10.0, 0.0), (0.0, 0.0)]; // walk back
      final second = buildMapFromTrace(
        trace2,
        base: first.map,
        nodeSeq: first.nodeSeq,
      );

      expect(second.map.corridors, hasLength(1));
      expect(second.map.nodes, hasLength(2));
    });

    test('two traces crossing create a connected graph with a crossing node',
        () {
      final first = buildMapFromTrace(
        [(0.0, 0.0), (10.0, 0.0), (20.0, 0.0)],
        base: GameMapData.empty(),
        nodeSeq: 1,
      );
      final second = buildMapFromTrace(
        [(10.0, -5.0), (10.0, 5.0)], // crosses the first corridor at (10, 0)
        base: first.map,
        nodeSeq: first.nodeSeq,
      );

      expect(second.map.nodes.length, 5); // 2 + 2 trace + 1 crossing
      expect(second.map.corridors.length, 4); // split + 2 new halves
      // The graph is connected: every node appears in some corridor.
      final used = second.map.corridors.expand((c) => [c.a, c.b]).toSet();
      expect(used.length, 5);
      for (final node in second.map.nodes) {
        expect(used.contains(node.id), isTrue, reason: '${node.id} isolated');
      }
      // A node exists exactly at the crossing point:
      expect(
        second.map.nodes.any((n) => n.x == 10.0 && n.y == 0.0),
        isTrue,
      );
    });
  });
}

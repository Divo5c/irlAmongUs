/// Converts a recorded GPS walk trace into the corridor graph of a
/// GameMapData structure.
///
/// Pipeline: simplify (Douglas-Peucker) → merge vertices onto existing/new
/// nodes (turns at street corners become single nodes; crossing an existing
/// network point reuses it, which automatically connects the networks) →
/// link consecutive vertices with corridors.
library;

import 'dart:math' as math;

import '../models/game_map.dart';

/// Simplifies a polyline with the Douglas-Peucker algorithm.
///
/// [epsilon] is in world units (meters). The first and last point are always
/// kept. Returns the original list when it has fewer than 3 points.
List<(double, double)> simplifyPolyline(
  List<(double, double)> points, {
  double epsilon = 0.8,
}) {
  if (points.length < 3) return List.of(points);
  final keep = List<bool>.filled(points.length, false);
  keep[0] = true;
  keep[points.length - 1] = true;
  _simplifyRange(points, 0, points.length - 1, epsilon, keep);
  return [
    for (var i = 0; i < points.length; i++)
      if (keep[i]) points[i],
  ];
}

double _pointSegmentDistance(
  (double, double) p,
  (double, double) a,
  (double, double) b,
) {
  final abx = b.$1 - a.$1;
  final aby = b.$2 - a.$2;
  final apx = p.$1 - a.$1;
  final apy = p.$2 - a.$2;
  final ab2 = abx * abx + aby * aby;
  if (ab2 == 0) {
    return _dist(p, a);
  }
  var t = (apx * abx + apy * aby) / ab2;
  t = t.clamp(0.0, 1.0);
  final cx = a.$1 + abx * t;
  final cy = a.$2 + aby * t;
  return _dist(p, (cx, cy));
}

double _dist((double, double) a, (double, double) b) {
  final dx = a.$1 - b.$1;
  final dy = a.$2 - b.$2;
  return math.sqrt(dx * dx + dy * dy);
}

void _simplifyRange(
  List<(double, double)> points,
  int first,
  int last,
  double epsilon,
  List<bool> keep,
) {
  if (last <= first + 1) return;
  var maxDist = -1.0;
  var maxIndex = -1;
  for (var i = first + 1; i < last; i++) {
    final d = _pointSegmentDistance(points[i], points[first], points[last]);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }
  if (maxDist > epsilon && maxIndex > 0) {
    keep[maxIndex] = true;
    _simplifyRange(points, first, maxIndex, epsilon, keep);
    _simplifyRange(points, maxIndex, last, epsilon, keep);
  }
}

/// Result of feeding a trace into an existing map.
class TraceBuildResult {
  const TraceBuildResult({required this.map, required this.nodeSeq});

  final GameMapData map;

  /// Next free node number after all generated nodes.
  final int nodeSeq;
}

double _squaredDistance(double ax, double ay, double bx, double by) {
  final dx = ax - bx;
  final dy = ay - by;
  return dx * dx + dy * dy;
}

int _maxNumericSuffix(Iterable<String> ids, String prefix) {
  var maxVal = 0;
  final prefixLen = prefix.length;
  for (final id in ids) {
    if (id.length <= prefixLen || !id.startsWith(prefix)) continue;
    final suffix = int.tryParse(id.substring(prefixLen));
    if (suffix != null && suffix > maxVal) maxVal = suffix;
  }
  return maxVal;
}

/// Builds corridor geometry from a GPS trace on top of [base].
///
/// Vertices within [mergeRadius] of an existing node snap to that node
/// (auto-connection with previously drawn networks or prior traces);
/// everything else becomes new nodes/corridors. Rooms and connections of
/// [base] are preserved untouched.
TraceBuildResult buildMapFromTrace(
  List<(double, double)> trace, {
  required GameMapData base,
  required int nodeSeq,
  double mergeRadius = 1.5,
  double epsilon = 0.8,
  double minSegmentLength = 1.0,
}) {
  var map = GameMapData(
    version: base.version,
    nodes: List.of(base.nodes),
    corridors: List.of(base.corridors),
    rooms: base.rooms,
    connections: base.connections,
  );

  var nextNode =
      _maxNumericSuffix(map.nodes.map((n) => n.id), 'n') + 1;
  var nextCorridor =
      _maxNumericSuffix(map.corridors.map((c) => c.id), 'c') + 1;

  final merge2 = mergeRadius * mergeRadius;

  String? lastNodeId;
  for (final vertex in simplifyPolyline(trace, epsilon: epsilon)) {
    // Snap to the nearest known node within the merge radius.
    String? nodeId;
    var best = merge2;
    for (final node in map.nodes) {
      final d = _squaredDistance(node.x, node.y, vertex.$1, vertex.$2);
      if (d < best) {
        best = d;
        nodeId = node.id;
      }
    }
    nodeId ??= 'n${nextNode++}';
    if (!map.nodes.any((n) => n.id == nodeId)) {
      map = _withNode(map, MapNode(id: nodeId, x: vertex.$1, y: vertex.$2));
    }

    final fromId = lastNodeId;
    if (fromId != null && fromId != nodeId) {
      map = _connectNodes(
        map,
        fromId,
        nodeId,
        minSegmentLength: minSegmentLength,
        onNewNode: () => 'n${nextNode++}',
        onNewCorridor: () => 'c${nextCorridor++}',
      );
    }
    lastNodeId = nodeId;
  }

  return TraceBuildResult(
    map: map,
    nodeSeq: _maxNumericSuffix(map.nodes.map((n) => n.id), 'n') + 1,
  );
}

GameMapData _withNode(GameMapData map, MapNode node) => GameMapData(
      version: map.version,
      nodes: [...map.nodes, node],
      corridors: map.corridors,
      rooms: map.rooms,
      connections: map.connections,
    );

/// Links [aId] and [bId] with a corridor — unless a duplicate exists.
///
/// When the new segment geometrically crosses an existing corridor, the
/// crossing is materialized: a node is placed at the intersection point and
/// the existing corridor is split, so street crossings become real graph
/// connections (reachable routes instead of two independent lines).
GameMapData _connectNodes(
  GameMapData map,
  String aId,
  String bId, {
  required double minSegmentLength,
  required String Function() onNewNode,
  required String Function() onNewCorridor,
}) {
  final duplicate = map.corridors.any(
    (c) => (c.a == aId && c.b == bId) || (c.a == bId && c.b == aId),
  );
  if (duplicate) return map;

  final a = map.nodes.firstWhere((n) => n.id == aId);
  final b = map.nodes.firstWhere((n) => n.id == bId);

  // Existing corridor crossing check (proper crossing only).
  for (final existing in map.corridors) {
    if (existing.a == aId || existing.b == aId) continue;
    if (existing.a == bId || existing.b == bId) continue;
    final c = map.nodes.firstWhere((n) => n.id == existing.a);
    final d = map.nodes.firstWhere((n) => n.id == existing.b);
    final cross = _properSegmentIntersection(
      (a.x, a.y), (b.x, b.y), (c.x, c.y), (d.x, d.y),
    );
    if (cross == null) continue;

    final xId = onNewNode();
    var next = _withNode(
      map,
      MapNode(id: xId, x: cross.$1, y: cross.$2),
    );
    // Split the existing corridor c-d into c-x and x-d.
    next = GameMapData(
      version: next.version,
      nodes: next.nodes,
      corridors: [
        for (final c2 in next.corridors)
          if (c2 == existing) ...[
            MapCorridor(id: onNewCorridor(), a: c.id, b: xId),
            MapCorridor(id: onNewCorridor(), a: xId, b: d.id),
          ] else
            c2,
      ],
      rooms: next.rooms,
      connections: next.connections,
    );
    // Connect new endpoints through the crossing node.
    next = GameMapData(
      version: next.version,
      nodes: next.nodes,
      corridors: [
        ...next.corridors,
        MapCorridor(id: onNewCorridor(), a: aId, b: xId),
        MapCorridor(id: onNewCorridor(), a: xId, b: bId),
      ],
      rooms: next.rooms,
      connections: next.connections,
    );
    return next;
  }

  // No crossing: normal straight link (with length gate).
  if (_dist((a.x, a.y), (b.x, b.y)) >= minSegmentLength) {
    return GameMapData(
      version: map.version,
      nodes: map.nodes,
      corridors: [
        ...map.corridors,
        MapCorridor(id: onNewCorridor(), a: aId, b: bId),
      ],
      rooms: map.rooms,
      connections: map.connections,
    );
  }
  return map;
}

/// Returns the intersection point when segments (p1,p2) and (p3,p4) properly
/// cross each other, else null.
(double, double)? _properSegmentIntersection(
  (double, double) p1,
  (double, double) p2,
  (double, double) p3,
  (double, double) p4,
) {
  final d1x = p2.$1 - p1.$1, d1y = p2.$2 - p1.$2;
  final d2x = p4.$1 - p3.$1, d2y = p4.$2 - p3.$2;
  final denom = d1x * d2y - d1y * d2x;
  if (denom.abs() < 1e-12) return null; // parallel
  final t = ((p3.$1 - p1.$1) * d2y - (p3.$2 - p1.$2) * d2x) / denom;
  final u = ((p3.$1 - p1.$1) * d1y - (p3.$2 - p1.$2) * d1x) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) {
    return null; // touching or outside — only proper crossings count
  }
  return (p1.$1 + t * d1x, p1.$2 + t * d1y);
}

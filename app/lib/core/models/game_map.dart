/// Lightweight typed view over the server's map payload
/// (shared/models/map.schema.json). Keeps the editor/rendering code safe
/// without introducing heavy serialization.
library;

import '../utils/room_roles.dart';

class MapNode {
  const MapNode({required this.id, required this.x, required this.y});

  final String id;
  final double x;
  final double y;

  static MapNode fromJson(Map<String, dynamic> json) => MapNode(
        id: json['id'] as String,
        x: (json['x'] as num).toDouble(),
        y: (json['y'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => {'id': id, 'x': x, 'y': y};
}

class MapCorridor {
  const MapCorridor({required this.id, required this.a, required this.b});

  final String id;
  final String a;
  final String b;
}

class MapRoom {
  const MapRoom({
    required this.id,
    required this.name,
    required this.type,
    required this.polygon,
  });

  final String id;
  final String name;
  final String type;
  final List<(double, double)> polygon;

  /// Centroid used for label placement and auto-connect distance checks.
  ({double x, double y}) get center {
    if (polygon.isEmpty) return (x: 0.0, y: 0.0);
    var sx = 0.0;
    var sy = 0.0;
    for (final p in polygon) {
      sx += p.$1;
      sy += p.$2;
    }
    return (x: sx / polygon.length, y: sy / polygon.length);
  }

  static MapRoom fromJson(Map<String, dynamic> json) => MapRoom(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'Room',
        type: json['type'] as String? ?? 'NORMAL',
        polygon: ((json['polygon'] as List?) ?? [])
            .whereType<Map>()
            .map((p) => (
                  (p['x'] as num).toDouble(),
                  (p['y'] as num).toDouble()
                ))
            .toList(),
      );

  bool isValidRole() => kRoomTypes.contains(type);
}

class GameMapData {
  const GameMapData({
    required this.version,
    required this.nodes,
    required this.corridors,
    required this.rooms,
    required this.connections,
  });

  final int version;
  final List<MapNode> nodes;
  final List<MapCorridor> corridors;
  final List<MapRoom> rooms;

  /// roomId -> corridor node ids (doors).
  final List<({String roomId, String nodeId})> connections;

  static GameMapData empty() => const GameMapData(
        version: 1,
        nodes: [],
        corridors: [],
        rooms: [],
        connections: [],
      );

  bool get isEmpty =>
      nodes.isEmpty && corridors.isEmpty && rooms.isEmpty;

  MapNode? nodeById(String id) {
    for (final node in nodes) {
      if (node.id == id) {
        return node;
      }
    }
    return null;
  }

  /// Nearest corridor node to [point] — used to auto-link a new room to the
  /// corridor network (its "door").
  MapNode? nearestNodeTo(double px, double py) {
    MapNode? best;
    var bestDist = double.infinity;
    for (final node in nodes) {
      final dx = node.x - px;
      final dy = node.y - py;
      final d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  static GameMapData fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return GameMapData.empty();
    }
    final nodes = ((json['nodes'] as List?) ?? [])
        .whereType<Map>()
        .map((n) => MapNode.fromJson(Map<String, dynamic>.from(n)))
        .toList();
    final corridors = ((json['corridors'] as List?) ?? [])
        .whereType<Map>()
        .map((c) {
          final m = Map<String, dynamic>.from(c);
          return MapCorridor(
            id: m['id'] as String,
            a: m['a'] as String,
            b: m['b'] as String,
          );
        })
        .toList();
    final rooms = ((json['rooms'] as List?) ?? [])
        .whereType<Map>()
        .map((r) => MapRoom.fromJson(Map<String, dynamic>.from(r)))
        .toList();
    final connections = ((json['connections'] as List?) ?? [])
        .whereType<Map>()
        .map((cn) {
          final m = Map<String, dynamic>.from(cn);
          return (
            roomId: m['roomId'] as String,
            nodeId: m['nodeId'] as String,
          );
        })
        .toList();

    return GameMapData(
      version: (json['version'] as num?)?.toInt() ?? 1,
      nodes: nodes,
      corridors: corridors,
      rooms: rooms,
      connections: connections,
    );
  }

  Map<String, dynamic> toPayload() => {
        'version': version,
        'nodes': [for (final n in nodes) n.toJson()],
        'corridors': [
          for (final c in corridors)
            {'id': c.id, 'a': c.a, 'b': c.b}
        ],
        'rooms': [
          for (final r in rooms)
            {
              'id': r.id,
              'name': r.name,
              'type': r.type,
              'polygon': [
                for (final p in r.polygon) {'x': p.$1, 'y': p.$2}
              ],
            }
        ],
        'connections': [
          for (final c in connections) {'roomId': c.roomId, 'nodeId': c.nodeId}
        ],
      };
}

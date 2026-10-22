/// OpenStreetMap street data via the free Overpass API.
///
/// The host taps "Streets" in the map editor; the app asks Overpass for all
/// mapped highways around the host's position, converts them to world
/// meters and draws them as selectable candidates. No walking required.
/// Data © OpenStreetMap contributors (ODbL).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'gps_projector.dart';

/// One street way from OSM.
class OsmStreet {
  const OsmStreet({
    required this.id,
    required this.name,
    required this.points,
  });

  final int id;
  final String name;

  /// Lat/lon pairs in degrees, in way order.
  final List<(double, double)> points;
}

/// World-space candidate for selection; points in meters rel. to anchor.
class OsmStreetCandidate {
  const OsmStreetCandidate({
    required this.id,
    required this.name,
    required this.points,
  });

  final int id;
  final String name;
  final List<(double, double)> points;
}

/// JSON sources are injectable for tests; defaults to Overpass.
typedef HttpTextFetcher = Future<String> Function(Uri url, Duration timeout);

class OsmService {
  OsmService({HttpTextFetcher? fetcher})
      : _fetch = fetcher ?? _defaultFetch;

  final HttpTextFetcher _fetch;

  /// Public Overpass endpoints tried in order; the main server is
  /// frequently at capacity (HTTP 502), the mirror usually is free.
  static const List<String> endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  /// Fetches all mapped highways around ([lat]/[lon] degrees) within
  /// [radiusM] meters. Throws when Overpass is unreachable.
  Future<List<OsmStreet>> fetchStreets({
    required double lat,
    required double lon,
    double radiusM = 300,
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final query = buildOverpassQuery(lat: lat, lon: lon, radiusM: radiusM);
    String? lastError;
    for (final endpoint in endpoints) {
      final url = Uri.parse('$endpoint?data=${Uri.encodeComponent(query)}');
      try {
        final body = await _fetch(url, timeout);
        return parseOverpassResponse(body);
      } on OsmException catch (error) {
        lastError = error.message;
        // Server side problems -> try the next mirror.
      }
    }
    throw OsmException(lastError ?? 'Overpass unreachable.');
  }

  static Future<String> _defaultFetch(Uri url, Duration timeout) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      // Overpass rejects plain Dart GET requests (missing User-Agent) with
      // HTTP 406. The official client form is POST with a urlencoded
      // `data` body — used here together with proper headers.
      final data = url.queryParameters['data'] ?? '';
      final bare = url.replace(queryParameters: const {});
      final request = await client.postUrl(bare);
      request.headers.set(HttpHeaders.userAgentHeader,
          'RealLifeAmongUs/0.1 (Flutter; real-life-amongus app)');
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      request.headers.contentType =
          ContentType('application', 'x-www-form-urlencoded');
      request.add(utf8.encode('data=${Uri.encodeComponent(data)}'));
      final response = await request.close();
      final body = await response.transform(utf8.decoder).join();
      if (response.statusCode != HttpStatus.ok) {
        final snippet = body.trim();
        final detail = snippet.isEmpty
            ? ''
            : ' Overpass: ${snippet.length > 120 ? snippet.substring(0, 120) : snippet}';
        throw OsmException(
          'Overpass request failed (HTTP ${response.statusCode}).$detail',
        );
      }
      return body;
    } finally {
      client.close(force: true);
    }
  }
}

class OsmException implements Exception {
  const OsmException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Overpass QL for mapped ways around a point.
String buildOverpassQuery({
  required double lat,
  required double lon,
  required double radiusM,
}) {
  final radius = radiusM.round();
  return '[out:json][timeout:15];'
      'way(around:$radius,$lat,$lon)["highway"];'
      'out geom;';
}

/// Parses an Overpass JSON response into streets.
List<OsmStreet> parseOverpassResponse(String body) {
  Object? decoded;
  try {
    decoded = jsonDecode(body);
  } catch (_) {
    throw const OsmException('Unexpected Overpass response.');
  }
  if (decoded is! Map<String, dynamic>) {
    throw const OsmException('Unexpected Overpass response.');
  }
  final elements = decoded['elements'] as List? ?? const [];
  final streets = <OsmStreet>[];
  for (final element in elements) {
    if (element is! Map<String, dynamic>) continue;
    if (element['type'] != 'way') continue;
    final geometry = element['geometry'] as List? ?? const [];
    final points = <(double, double)>[];
    for (final point in geometry) {
      if (point is! Map<String, dynamic>) continue;
      final lat = (point['lat'] as num?)?.toDouble();
      final lon = (point['lon'] as num?)?.toDouble();
      if (lat == null || lon == null) continue;
      points.add((lat, lon));
    }
    if (points.length < 2) continue;
    final tags = element['tags'] as Map<String, dynamic>? ?? const {};
    final id = (element['id'] as num?)?.toInt() ?? 0;
    final name = (tags['name'] as String?)?.trim();
    final highway = (tags['highway'] as String?)?.trim();
    streets.add(OsmStreet(
      id: id,
      name: (name != null && name.isNotEmpty)
          ? name
          : 'Way ${highway ?? id}',
      points: points,
    ));
  }
  return streets;
}

/// Converts raw OSM streets into world-meter candidates anchored at
/// (anchorLat/anchorLon) — the fix the query was sent around.
List<OsmStreetCandidate> toCandidates(
  List<OsmStreet> streets, {
  required double anchorLat,
  required double anchorLon,
}) {
  final projector = GeoProjector.anchoredAt(anchorLat, anchorLon);
  return [
    for (final s in streets)
      OsmStreetCandidate(
        id: s.id,
        name: s.name,
        points: [
          for (final (lat, lon) in s.points) projector.project(lat, lon),
        ],
      ),
  ];
}

/// Nearest candidate's distance to a point; null when too far (> 20 m).
/// Returns (candidate, distance) so the editor can pick exactly one street
/// per tap.
(OsmStreetCandidate, double)? nearestCandidateTo(
  List<OsmStreetCandidate> candidates,
  double px,
  double py,
) {
  OsmStreetCandidate? best;
  var bestDist = double.infinity;
  for (final c in candidates) {
    for (var i = 1; i < c.points.length; i++) {
      final a = c.points[i - 1];
      final b = c.points[i];
      final d = _distanceToSegment(px, py, a, b);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  if (best == null || bestDist > 20) return null;
  return (best, bestDist);
}

double _distanceToSegment(
  double px,
  double py,
  (double, double) a,
  (double, double) b,
) {
  final abx = b.$1 - a.$1;
  final aby = b.$2 - a.$2;
  final apx = px - a.$1;
  final apy = py - a.$2;
  final ab2 = abx * abx + aby * aby;
  if (ab2 == 0) return math.sqrt(apx * apx + apy * apy);
  var t = (apx * abx + apy * aby) / ab2;
  t = t.clamp(0.0, 1.0);
  final cx = a.$1 + abx * t;
  final cy = a.$2 + aby * t;
  final dx = px - cx;
  final dy = py - cy;
  return math.sqrt(dx * dx + dy * dy);
}

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/positioning/osm_streets.dart';

final sampleResponse = jsonEncode({
  'version': 0.6,
  'elements': [
    {
      'type': 'way',
      'id': 101,
      'tags': {'highway': 'residential', 'name': 'Hauptstraße'},
      'geometry': [
        {'lat': 51.0, 'lon': 6.0},
        {'lat': 51.0, 'lon': 6.0001},
        {'lat': 51.0, 'lon': 6.0002},
      ],
    },
    {
      'type': 'way',
      'id': 102,
      'tags': {'highway': 'path'},
      'geometry': [
        {'lat': 51.0001, 'lon': 6.0},
        {'lat': 51.0002, 'lon': 6.0},
      ],
    },
    {'type': 'node', 'id': 3},
    {
      'type': 'way',
      'id': 103,
      'geometry': [], // no geometry → skipped
    },
  ],
});

void main() {
  group('Overpass query', () {
    test('contains radius, coordinates and highway filter', () {
      final q = buildOverpassQuery(lat: 51.0, lon: 6.0, radiusM: 300);
      expect(q, contains('around:300,51.0,6.0'));
      expect(q, contains('"highway"'));
      expect(q, contains('[out:json]'));
    });
  });

  group('parseOverpassResponse', () {
    test('extracts ways with names and fallback names', () {
      final streets = parseOverpassResponse(sampleResponse);
      expect(streets, hasLength(2));
      expect(streets[0].id, 101);
      expect(streets[0].name, 'Hauptstraße');
      expect(streets[0].points, hasLength(3));
      expect(streets[1].name, 'Way path'); // no name → highway-based fallback
    });

    test('throws on garbage', () {
      expect(
        () => parseOverpassResponse('not json'),
        throwsA(isA<OsmException>()),
      );
    });
  });

  group('toCandidates', () {
    test('projects around anchor with north = -Y', () {
      final streets = parseOverpassResponse(sampleResponse);
      final candidates = toCandidates(
        streets,
        anchorLat: 51.0,
        anchorLon: 6.0,
      );
      expect(candidates, hasLength(2));
      final first = candidates[0].points.first;
      // First point IS the anchor → (0,0):
      expect(first.$1, closeTo(0, 1e-6));
      expect(first.$2, closeTo(0, 1e-6));
      // Second point of way 102 lies north → negative Y:
      final northPt = candidates[1].points.last;
      expect(northPt.$2, lessThan(0));
    });
  });

  group('nearestCandidateTo', () {
    test('finds the closest street within tolerance', () {
      final candidates = [
        OsmStreetCandidate(id: 1, name: 'A', points: [(0.0, 0.0), (10.0, 0.0)]),
        OsmStreetCandidate(
          id: 2,
          name: 'B',
          points: [(0.0, -8.0), (10.0, -8.0)],
        ),
      ];
      final (hit, dist) = nearestCandidateTo(candidates, 5.0, -2.0)!;
      expect(hit.id, 1);
      expect(dist, lessThan(3));
      expect(nearestCandidateTo(candidates, 5.0, 30.0), isNull); // too far
    });
  });

  group('OsmService', () {
    test('fetches and parses through the injectable fetcher', () async {
      final service = OsmService(
        fetcher: (url, _) async {
          expect(url.host, 'overpass-api.de');
          return sampleResponse;
        },
      );
      final streets = await service.fetchStreets(lat: 51.0, lon: 6.0);
      expect(streets, hasLength(2));
    });

    test('falls back to the mirror when the main server fails', () async {
      final hosts = <String>[];
      final service = OsmService(
        fetcher: (url, _) async {
          hosts.add(url.host);
          if (url.host == 'overpass-api.de') {
            throw const OsmException('Overpass request failed (HTTP 502).');
          }
          return sampleResponse;
        },
      );
      final streets = await service.fetchStreets(lat: 51.0, lon: 6.0);
      expect(streets, hasLength(2));
      expect(hosts, contains('overpass.kumi.systems'));
    });
  });
}

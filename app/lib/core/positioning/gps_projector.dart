/// GPS-to-world coordinate conversion.
///
/// World coordinates are metric with the same convention the PDR pipeline
/// uses: 1 unit = 1 meter, north = -Y, east = +X. The first accepted fix
/// pinpoints the origin (0, 0); every later fix is offset relative to it.
library;

import 'dart:math' as math;

/// Earth radius used for the flat-earth approximation (WGS-84 mean).
const double earthRadiusM = 6371000.0;

/// Converts latitude/longitude pairs into local metric world coordinates.
///
/// Fixes are offset relative to [originLat]/[originLon] (in degrees) using a
/// local equirectangular projection, which is accurate to well under a
/// percent for the few hundred meters around one birthday playground.
class GeoProjector {
  const GeoProjector({required this.originLat, required this.originLon});

  final double originLat;
  final double originLon;

  /// World X (east) and world Y (north negative) for [lat]/[lon] in degrees.
  (double, double) project(double lat, double lon) {
    final dLatRad = (lat - originLat) * math.pi / 180.0;
    final dLonRad = (lon - originLon) * math.pi / 180.0;
    final north = earthRadiusM * dLatRad;
    final east =
        earthRadiusM * dLonRad * math.cos(originLat * math.pi / 180.0);
    return (east, -north);
  }

  /// Builds a projector that anchors a specific fix at (0, 0).
  static GeoProjector anchoredAt(double lat, double lon) =>
      GeoProjector(originLat: lat, originLon: lon);
}

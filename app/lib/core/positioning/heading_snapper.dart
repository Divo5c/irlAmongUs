/// Snaps a compass heading to 90-degree steps for PDR movement direction.
///
/// Pure function object with minimal sticky state (hysteresis only).
/// Does NOT touch sensors, step detection, stride estimation or heading
/// fusion — it only quantizes the heading value handed to the PDR
/// displacement. Raw sensor headings (arrow, diagnostics, estimates)
/// intentionally keep flowing unmodified.
///
/// Mapping (matches the requested sectors):
///   0–44 deg    -> 0 deg (north)
///   45–134 deg  -> 90 deg (east)
///   135–224 deg -> 180 deg (south)
///   225–314 deg -> 270 deg (west)
///   315–359 deg -> 0 deg (north)
///
/// Hysteresis: once snapped to a cardinal direction, the snap point only
/// switches when the heading comes within (45 - [hysteresisDeg]) degrees of
/// another cardinal. With the default 10 degrees the switch happens 10
/// degrees past the sector boundary, so jitter at the boundary cannot make
/// the corridor direction flicker back and forth. The very first snap after
/// construction/[reset] takes the nominal sector directly — there is no
/// established direction to be sticky about yet.
library;

class HeadingSnapper {
  HeadingSnapper({this.hysteresisDeg = 10.0});

  /// Half-width of the dead band around each sector boundary, in degrees.
  final double hysteresisDeg;

  int _snapped = 0;
  bool _hasDirection = false;

  /// Currently snapped cardinal direction (0, 90, 180 or 270).
  int get snapped => _snapped;

  /// Resets to [initial] (a cardinal direction, defaults to north).
  void reset([int initial = 0]) {
    _snapped = initial;
    _hasDirection = false;
  }

  /// Returns the snapped cardinal direction for [headingDeg].
  int snap(double headingDeg) {
    var h = headingDeg % 360.0;
    if (h < 0) h += 360.0;

    var best = 0;
    var bestDist = 360.0;
    for (final c in _cardinals) {
      var d = (h - c).abs();
      if (d > 180) d = 360 - d;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (!_hasDirection) {
      _snapped = best;
      _hasDirection = true;
      return _snapped;
    }
    if (best == _snapped) return _snapped;
    if (bestDist <= 45.0 - hysteresisDeg) {
      _snapped = best;
    }
    return _snapped;
  }

  static const List<int> _cardinals = [0, 90, 180, 270];
}

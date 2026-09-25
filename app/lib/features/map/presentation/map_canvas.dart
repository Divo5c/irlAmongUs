import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../core/models/game_map.dart';
import '../../../core/utils/room_roles.dart';
import 'heading_arrow.dart';

/// Bounding box of map content in world coordinates, or null when empty.
///
/// Pure function (extracted for testability). [MapCanvas.build] derives the
/// canvas size and origin from it.
({double minX, double minY, double maxX, double maxY})? computeMapContentBounds({
  required GameMapData map,
  required List<Offset> pendingPoints,
  required Offset? hostPosition,
}) {
  double minX = double.infinity, minY = double.infinity;
  double maxX = double.negativeInfinity, maxY = double.negativeInfinity;
  var hasAny = false;

  void expand(double x, double y) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  for (final n in map.nodes) {
    expand(n.x, n.y);
    hasAny = true;
  }
  for (final r in map.rooms) {
    for (final p in r.polygon) {
      expand(p.$1, p.$2);
      hasAny = true;
    }
  }
  for (final p in pendingPoints) {
    expand(p.dx, p.dy);
    hasAny = true;
  }
  if (hostPosition != null) {
    expand(hostPosition.dx, hostPosition.dy);
    hasAny = true;
  }
  if (!hasAny) return null;
  return (minX: minX, minY: minY, maxX: maxX, maxY: maxY);
}

/// Canvas pixel position of world (0,0) for a canvas of [canvasSize] showing
/// [bounds] at [pixelsPerMeter]. Pure function (extracted for testability).
/// The painter maps world to canvas as `origin + world * pixelsPerMeter`.
Offset mapCanvasOrigin({
  required ({double minX, double minY, double maxX, double maxY})? bounds,
  required Size canvasSize,
  required double pixelsPerMeter,
}) {
  if (bounds == null) {
    return Offset(canvasSize.width / 2, canvasSize.height / 2);
  }
  return Offset(
    canvasSize.width / 2 - ((bounds.minX + bounds.maxX) / 2) * pixelsPerMeter,
    canvasSize.height / 2 - ((bounds.minY + bounds.maxY) / 2) * pixelsPerMeter,
  );
}

/// Interactive 2D map rendering: grid + corridor graph + room polygons.
/// Supports pan/zoom via [InteractiveViewer] in the parent screens.
///
/// The canvas dynamically sizes to fit all map content (nodes, rooms,
/// pending points) plus padding. World coordinates are mapped to canvas
/// pixels via a configurable [pixelsPerMeter] scale.
class MapCanvas extends StatelessWidget {
  const MapCanvas({
    required this.map,
    this.pendingPoints = const <Offset>[],
    this.pendingModeIsRoom = false,
    this.showGrid = true,
    this.hostPosition,
    this.hostHeadingDeg,
    this.pixelsPerMeter = 8.0,
    this.onTapWorld,
    super.key,
  });

  final GameMapData map;
  final List<Offset> pendingPoints;
  final bool pendingModeIsRoom;
  final bool showGrid;

  /// Current host position (live PDR) shown as a "YOU" marker.
  final Offset? hostPosition;

  /// Fused PDR heading in degrees (0=north, 90=east) for the host arrow.
  /// Null means unknown — the arrow then defaults to 0 degrees.
  final double? hostHeadingDeg;

  /// Scale: world meters → canvas pixels. Default 8px/m for typical buildings.
  final double pixelsPerMeter;

  /// When set, taps on the canvas are reported in world coordinates.
  final void Function(double x, double y)? onTapWorld;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final mapBounds = computeMapContentBounds(
          map: map,
          pendingPoints: pendingPoints,
          hostPosition: hostPosition,
        );
        final hasContent = mapBounds != null;

        // Canvas size: fit content + padding, but at least fill the viewport.
        const padding = 80.0;
        final contentW = hasContent
            ? (mapBounds.maxX - mapBounds.minX) * pixelsPerMeter + padding * 2
            : 0.0;
        final contentH = hasContent
            ? (mapBounds.maxY - mapBounds.minY) * pixelsPerMeter + padding * 2
            : 0.0;
        final cw = math.max(constraints.maxWidth, contentW);
        final ch = math.max(constraints.maxHeight, contentH);

        // Center offset: where world (0,0) appears on the canvas.
        final origin = mapCanvasOrigin(
          bounds: mapBounds,
          canvasSize: Size(cw, ch),
          pixelsPerMeter: pixelsPerMeter,
        );

        return ClipRect(
          child: InteractiveViewer(
            minScale: 0.3,
            maxScale: 8,
            boundaryMargin: const EdgeInsets.all(10000),
            child: SizedBox(
              width: cw,
              height: ch,
              child: CustomPaint(
                painter: _MapPainter(
                  map: map,
                  pendingPoints: pendingPoints,
                  pendingModeIsRoom: pendingModeIsRoom,
                  showGrid: showGrid,
                  hostPosition: hostPosition,
                  hostHeadingDeg: hostHeadingDeg,
                  ppm: pixelsPerMeter,
                  origin: origin,
                  scheme: Theme.of(context).colorScheme,
                  textDirection: Directionality.of(context),
                  defaultTextStyle: DefaultTextStyle.of(context).style,
                ),
                child: const SizedBox.expand(),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MapPainter extends CustomPainter {
  _MapPainter({
    required this.map,
    required this.pendingPoints,
    required this.pendingModeIsRoom,
    required this.showGrid,
    required this.hostPosition,
    required this.hostHeadingDeg,
    required this.ppm,
    required this.origin,
    required this.scheme,
    required this.textDirection,
    required this.defaultTextStyle,
  });

  final GameMapData map;
  final List<Offset> pendingPoints;
  final bool pendingModeIsRoom;
  final bool showGrid;
  final Offset? hostPosition;
  final double? hostHeadingDeg;
  final double ppm;
  final Offset origin;
  final ColorScheme scheme;
  final TextDirection textDirection;
  final TextStyle defaultTextStyle;

  /// World coordinates → canvas pixel coordinates.
  Offset _w2c(double x, double y) => Offset(
        origin.dx + x * ppm,
        origin.dy + y * ppm,
      );

  @override
  void paint(Canvas canvas, Size size) {
    if (showGrid) _paintGrid(canvas, size);
    _paintRooms(canvas);
    _paintCorridors(canvas);
    _paintHostMarker(canvas);
    if (pendingPoints.isNotEmpty) _paintPending(canvas);
  }

  // ──────────────────────────────────────────── Grid (world-space) ──────

  void _paintGrid(Canvas canvas, Size size) {
    if (ppm <= 0) return;

    // World bounds visible on this canvas.
    final wMinX = -origin.dx / ppm;
    final wMinY = -origin.dy / ppm;
    final wMaxX = (size.width - origin.dx) / ppm;
    final wMaxY = (size.height - origin.dy) / ppm;

    final minorPaint = Paint()
      ..color = scheme.outlineVariant.withValues(alpha: 0.25)
      ..strokeWidth = 0.5;
    final majorPaint = Paint()
      ..color = scheme.outlineVariant.withValues(alpha: 0.45)
      ..strokeWidth = 1;

    // Minor grid every 2 meters, major every 10 meters.
    final minorStep = 2.0;
    final majorStep = 10.0;

    final startMinorX = (wMinX / minorStep).floor() * minorStep;
    final startMinorY = (wMinY / minorStep).floor() * minorStep;

    for (var wx = startMinorX; wx <= wMaxX; wx += minorStep) {
      final isMajor = (wx % majorStep).abs() < 0.01;
      final cx = origin.dx + wx * ppm;
      canvas.drawLine(Offset(cx, 0), Offset(cx, size.height),
          isMajor ? majorPaint : minorPaint);
    }
    for (var wy = startMinorY; wy <= wMaxY; wy += minorStep) {
      final isMajor = (wy % majorStep).abs() < 0.01;
      final cy = origin.dy + wy * ppm;
      canvas.drawLine(Offset(0, cy), Offset(size.width, cy),
          isMajor ? majorPaint : minorPaint);
    }

    // World origin marker.
    final originCanvas = _w2c(0, 0);
    canvas.drawCircle(originCanvas, 3, Paint()..color = scheme.primary);
  }

  // ──────────────────────────────────────── Corridors + Nodes ───────────

  void _paintCorridors(Canvas canvas) {
    // Corridor lines.
    final linePaint = Paint()
      ..color = scheme.onSurface.withValues(alpha: 0.85)
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;

    for (final corridor in map.corridors) {
      final a = map.nodeById(corridor.a);
      final b = map.nodeById(corridor.b);
      if (a == null || b == null) continue;
      canvas.drawLine(_w2c(a.x, a.y), _w2c(b.x, b.y), linePaint);
    }

    // Nodes: small but visible dots.
    final nodePaint = Paint()..color = scheme.primary;
    for (final node in map.nodes) {
      canvas.drawCircle(_w2c(node.x, node.y), 3, nodePaint);
    }
  }

  // ──────────────────────────────────────── Host live marker ────────────

  void _paintHostMarker(Canvas canvas) {
    if (hostPosition == null) return;
    final pos = _w2c(hostPosition!.dx, hostPosition!.dy);

    // Heading arrow (PDR convention); unknown heading defaults to north.
    paintHeadingArrow(
      canvas,
      center: pos,
      headingDeg: hostHeadingDeg ?? 0.0,
      color: scheme.tertiary,
    );

    // "YOU" label below the marker.
    final tp = TextPainter(
      text: TextSpan(
        text: 'YOU',
        style: defaultTextStyle.copyWith(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: scheme.tertiary,
        ),
      ),
      textAlign: TextAlign.center,
      textDirection: textDirection,
    )..layout();
    tp.paint(canvas, pos + Offset(-tp.width / 2, 10));
  }

  // ──────────────────────────────────────── Rooms ───────────────────────

  void _paintRooms(Canvas canvas) {
    for (final room in map.rooms) {
      if (room.polygon.length < 3) continue;

      final roomColor = roomTypeColor(room.type, scheme);

      // Filled polygon.
      final fill = Paint()
        ..color = roomColor.withValues(alpha: 0.20);
      // Stroke polygon.
      final stroke = Paint()
        ..color = roomColor
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round;

      final path = Path();
      final first = _w2c(room.polygon.first.$1, room.polygon.first.$2);
      path.moveTo(first.dx, first.dy);
      for (var i = 1; i < room.polygon.length; i++) {
        final p = _w2c(room.polygon[i].$1, room.polygon[i].$2);
        path.lineTo(p.dx, p.dy);
      }
      path.close();
      canvas.drawPath(path, fill);
      canvas.drawPath(path, stroke);

      // Door links (thin line from room center to corridor node).
      final center = _w2c(room.center.x, room.center.y);
      for (final connection in map.connections) {
        if (connection.roomId != room.id) continue;
        final node = map.nodeById(connection.nodeId);
        if (node == null) continue;
        final doorPaint = Paint()
          ..color = scheme.onSurface.withValues(alpha: 0.35)
          ..strokeWidth = 1.5
          ..strokeCap = StrokeCap.round;
        canvas.drawLine(center, _w2c(node.x, node.y), doorPaint);
      }

      // Room label.
      final tp = TextPainter(
        text: TextSpan(
          text: room.name,
          style: defaultTextStyle.copyWith(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: scheme.onSurface,
          ),
        ),
        textAlign: TextAlign.center,
        textDirection: textDirection,
      )..layout(maxWidth: 160);
      tp.paint(
        canvas,
        center - Offset(tp.width / 2, tp.height / 2),
      );
    }
  }

  // ──────────────────────────────────────── Pending points ──────────────

  void _paintPending(Canvas canvas) {
    if (pendingPoints.isEmpty) return;

    final color = pendingModeIsRoom
        ? const Color(0xFFE53935)
        : scheme.primary;

    // Pending corridor lines (dashed style via thinner stroke).
    final linePaint = Paint()
      ..color = color.withValues(alpha: 0.7)
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    for (var i = 1; i < pendingPoints.length; i++) {
      canvas.drawLine(
        _w2c(pendingPoints[i - 1].dx, pendingPoints[i - 1].dy),
        _w2c(pendingPoints[i].dx, pendingPoints[i].dy),
        linePaint,
      );
    }

    // Room preview: closing edge.
    if (pendingModeIsRoom && pendingPoints.length >= 3) {
      canvas.drawLine(
        _w2c(pendingPoints.last.dx, pendingPoints.last.dy),
        _w2c(pendingPoints.first.dx, pendingPoints.first.dy),
        linePaint..color = color.withValues(alpha: 0.35),
      );
    }

    // Pending point dots.
    for (var i = 0; i < pendingPoints.length; i++) {
      final isLast = i == pendingPoints.length - 1;
      canvas.drawCircle(
        _w2c(pendingPoints[i].dx, pendingPoints[i].dy),
        isLast ? 5 : 3.5,
        Paint()..color = color,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _MapPainter oldDelegate) {
    // NB: pendingPoints is mutated in place by the editor, so compare by
    // content — identity comparison would miss newly added draft points and
    // the pending dot would not repaint until the next map commit.
    return oldDelegate.map != map ||
        !listEquals(oldDelegate.pendingPoints, pendingPoints) ||
        oldDelegate.pendingModeIsRoom != pendingModeIsRoom ||
        oldDelegate.showGrid != showGrid ||
        oldDelegate.hostPosition != hostPosition ||
        oldDelegate.hostHeadingDeg != hostHeadingDeg ||
        oldDelegate.ppm != ppm ||
        oldDelegate.scheme != scheme;
  }
}

/// Converts a tap position inside the canvas back into world coordinates.
Offset worldFromCanvasPoint(Offset canvasPoint, Offset origin, double ppm) {
  return Offset(
    (canvasPoint.dx - origin.dx) / ppm,
    (canvasPoint.dy - origin.dy) / ppm,
  );
}

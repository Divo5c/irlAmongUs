/// Heading arrow for the live player position (debugging tool).
///
/// Uses the PDR compass convention also used by [PdrEngine] displacement:
/// 0 deg = north = up (-Y on screen), 90 deg = east = right (+X), clockwise.
/// The arrow shows the fused heading stored on [PositionEstimate], which is
/// the exact same value the PDR uses for dx/dy — phone orientation and
/// movement direction are intentionally NOT separated (the current system
/// maintains a single fused heading).
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Unit direction vector for a PDR compass heading (screen coordinates).
Offset headingDirection(double headingDeg) {
  final rad = headingDeg * math.pi / 180.0;
  return Offset(math.sin(rad), -math.cos(rad));
}

/// Tip of an arrow of [length] starting at [center].
Offset headingArrowTip(Offset center, double headingDeg, double length) {
  final dir = headingDirection(headingDeg);
  return center + dir * length;
}

/// Wing endpoints of the arrow head: a symmetric V behind [tip].
/// [headLength] is measured back along the shaft, [headWidth] across it.
({Offset left, Offset right}) headingArrowHead(
  Offset tip,
  double headingDeg,
  double headLength,
  double headWidth,
) {
  final dir = headingDirection(headingDeg);
  final base = tip - dir * headLength;
  final perp = Offset(-dir.dy, dir.dx);
  return (
    left: base + perp * (headWidth / 2),
    right: base - perp * (headWidth / 2),
  );
}

/// Paints a small heading arrow centered near [center].
/// [length] is the total arrow extent in logical pixels (default 16).
/// Stable by construction: callers pass the heading snapshot stored on the
/// position estimate, which only changes when a new estimate arrives — so
/// the arrow cannot flicker while standing still.
void paintHeadingArrow(
  Canvas canvas, {
  required Offset center,
  required double headingDeg,
  required Color color,
  double length = 16,
  double strokeWidth = 3,
}) {
  final dir = headingDirection(headingDeg);
  final tip = center + dir * (length * 0.62);
  final tail = center - dir * (length * 0.38);
  final head = headingArrowHead(tip, headingDeg, length * 0.32, length * 0.5);
  final paint = Paint()
    ..color = color
    ..strokeWidth = strokeWidth
    ..strokeCap = StrokeCap.round;
  canvas.drawLine(tail, tip, paint);
  canvas.drawLine(tip, head.left, paint);
  canvas.drawLine(tip, head.right, paint);
  // Exact position dot.
  canvas.drawCircle(center, strokeWidth * 0.9, Paint()..color = color);
}

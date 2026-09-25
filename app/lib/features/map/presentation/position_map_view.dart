/// Map view showing the player's own position on the game map.
///
/// This screen is shown during IN_GAME status. The player sees:
/// - The complete map (corridors, rooms, connections)
/// - Their own position marker (YOU)
/// - Their current room name (if inside a room)
/// - A toggle for debug mode (tap to set position manually)
///
/// Other players' positions are NEVER shown here (privacy).
library;

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/models/position_estimate.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/core/positioning/android_sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/core/utils/room_roles.dart';
import 'package:real_life_amongus_app/features/map/presentation/calibration_screen.dart';
import 'package:real_life_amongus_app/core/positioning/sensor_provider.dart';
import 'package:real_life_amongus_app/shared/widgets/diagnostics_panel.dart';

import 'heading_arrow.dart';

class PositionMapView extends StatefulWidget {
  const PositionMapView({
    required this.socketClient,
    required this.roomCode,
    required this.playerId,
    required this.room,
    super.key,
  });

  final RoomSocketClient socketClient;
  final String roomCode;
  final String playerId;
  final Map<String, dynamic> room;

  @override
  State<PositionMapView> createState() => _PositionMapViewState();
}

class _PositionMapViewState extends State<PositionMapView> {
  late final PositioningService _positioning;
  GameMapData? _gameMap;
  PositionEstimate? _currentPosition;
  String? _currentRoomName;
  bool _showDiagnostics = false;
  bool _debugMode = false;
  bool _sensorMode = false;
  Timer? _diagTimer;

  @override
  void initState() {
    super.initState();
    _gameMap = GameMapData.fromJson(
      widget.room['map'] is Map
          ? Map<String, dynamic>.from(widget.room['map'] as Map)
          : null,
    );
    _positioning = PositioningService(map: _gameMap);

    // Listen for server confirmations
    _positionConfirmedSub = widget.socketClient.positionConfirmed.listen(
      (data) {
        if (data['code'] == widget.roomCode && mounted) {
          final confirmed = PositionEstimate.fromServer(data);
          _positioning.applyServerConfirmation(data);
          setState(() {
            _currentPosition = confirmed;
            _updateRoomName(confirmed.roomId);
          });
        }
      },
    );
    _diagTimer = Timer.periodic(const Duration(milliseconds: 300), (_) {
      if (mounted && _showDiagnostics) setState(() {});
    });
    // Live heading refreshes the debug arrow independently of PDR steps.
    _headingSub = _positioning.headingStream.listen((_) {
      if (mounted) setState(() {});
    });
  }

  StreamSubscription<Map<String, dynamic>>? _positionConfirmedSub;
  StreamSubscription<double>? _headingSub;

  @override
  void dispose() {
    _diagTimer?.cancel();
    _headingSub?.cancel();
    _positionConfirmedSub?.cancel();
    _positioning.dispose();
    super.dispose();
  }

  void _updateRoomName(String? roomId) {
    if (roomId == null || _gameMap == null) {
      _currentRoomName = null;
      return;
    }
    for (final room in _gameMap!.rooms) {
      if (room.id == roomId) {
        _currentRoomName = room.name;
        return;
      }
    }
    _currentRoomName = null;
  }

  void _onMapTap(TapUpDetails details, MapConstraints constraints) {
    if (!_debugMode) return;
    if (_gameMap == null || _gameMap!.isEmpty) return;

    // Convert tap position to world coordinates
    final worldX = (details.localPosition.dx / constraints.scaleX) -
        constraints.offsetX;
    final worldY = (details.localPosition.dy / constraints.scaleY) -
        constraints.offsetY;

    _positioning.updateManualPosition(worldX, worldY);

    // Send to server
    widget.socketClient.sendPositionUpdate(
      code: widget.roomCode,
      x: worldX,
      y: worldY,
      heading: null,
      confidence: 1.0,
      source: 'MANUAL_DEBUG',
    );
  }

  void _showCalibrationDialog(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) => CalibrationScreen(
        sensorProvider: AndroidSensorProvider(),
        onCalibrationComplete: (factor) {
          // Update the PDR engine's step length factor
          _positioning.startCalibration(10.0);
          _positioning.completeCalibration(10.0);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Column(
      children: [
        // Position info bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: colorScheme.surfaceContainerHighest,
          child: Row(
            children: [
              Icon(Icons.person_pin_circle_rounded, color: colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _currentRoomName ?? 'In Corridor',
                      style: textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    if (_currentPosition != null)
                      Text(
                        'x: ${_currentPosition!.x.toStringAsFixed(1)}, '
                        'y: ${_currentPosition!.y.toStringAsFixed(1)}',
                        style: textTheme.bodySmall,
                      ),
                  ],
                ),
              ),
              // Debug mode toggle
              IconButton(
                key: const Key('debug-mode-toggle'),
                icon: Icon(
                  _debugMode ? Icons.bug_report : Icons.bug_report_outlined,
                  color: _debugMode ? colorScheme.error : null,
                ),
                tooltip: _debugMode ? 'Exit debug mode' : 'Debug: tap to set position',
                onPressed: () {
                  setState(() {
                    _debugMode = !_debugMode;
                    if (_debugMode) {
                      _sensorMode = false;
                      _positioning.enableDebugMode();
                    } else {
                      _positioning.disable();
                    }
                  });
                },
              ),
              // Sensor mode toggle
              IconButton(
                key: const Key('sensor-mode-toggle'),
                icon: Icon(
                  _sensorMode ? Icons.sensors : Icons.sensors_off,
                  color: _sensorMode ? colorScheme.primary : null,
                ),
                tooltip: _sensorMode ? 'Disable sensors' : 'Enable sensor positioning',
                onPressed: () {
                  setState(() {
                    _sensorMode = !_sensorMode;
                    if (_sensorMode) {
                      _debugMode = false;
                      _positioning.enableSensorMode();
                    } else {
                      _positioning.disable();
                    }
                  });
                },
              ),
              // Diagnostics toggle
              IconButton(
                key: const Key('diagnostics-toggle'),
                icon: const Icon(Icons.info_outline),
                tooltip: 'Position diagnostics',
                onPressed: () {
                  setState(() => _showDiagnostics = !_showDiagnostics);
                },
              ),
            ],
          ),
        ),

        // Map area
        Expanded(
          child: _gameMap == null || _gameMap!.isEmpty
              ? const Center(child: Text('No map available'))
              : Stack(
                  children: [
                    // The map canvas
                    GestureDetector(
                      onTapUp: _debugMode
                          ? (d) => _onMapTap(d, _getConstraints())
                          : null,
                      child: CustomPaint(
                        key: const Key('position-map-canvas'),
                        painter: _PositionMapPainter(
                          gameMap: _gameMap!,
                          currentPosition: _currentPosition,
                          liveHeadingDeg: _positioning.liveHeadingDeg,
                          debugMode: _debugMode,
                          colorScheme: colorScheme,
                        ),
                        size: Size.infinite,
                      ),
                    ),

                    // Debug mode indicator
                    if (_debugMode)
                      Positioned(
                        top: 8,
                        left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: colorScheme.error,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'DEBUG: Tap map to set position',
                            style: textTheme.labelSmall?.copyWith(
                              color: colorScheme.onError,
                            ),
                          ),
                        ),
                      ),

                    // Sensor mode indicator
                    if (_sensorMode)
                      Positioned(
                        top: 8,
                        left: 8,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: colorScheme.primary,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'SENSORS: Positioning active',
                            style: textTheme.labelSmall?.copyWith(
                              color: colorScheme.onPrimary,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
        ),

        // Diagnostics panel (expandable) — live 300ms refresh
        if (_showDiagnostics)
          SizedBox(
            height: 380,
            child: SingleChildScrollView(
              child: DiagnosticsPanel(
                currentPosition: _currentPosition,
                gameMap: _gameMap,
                sensorStatus: _positioning.sensorStatus,
                stepLog: _positioning.stepLog,
                onCalibrate: _sensorMode ? () => _showCalibrationDialog(context) : null,
                onResetPosition: () {
                  _positioning.resetPosition();
                  setState(() {
                    _currentPosition = _positioning.currentPosition;
                    _currentRoomName = null;
                  });
                },
              ),
            ),
          ),
      ],
    );
  }

  MapConstraints _getConstraints() {
    // This is a simplification; in production, use LayoutBuilder
    return MapConstraints(scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0);
  }
}

/// Simple constraint data for coordinate conversion.
class MapConstraints {
  const MapConstraints({
    required this.scaleX,
    required this.scaleY,
    required this.offsetX,
    required this.offsetY,
  });
  final double scaleX;
  final double scaleY;
  final double offsetX;
  final double offsetY;
}

/// Custom painter for the game map with position marker.
class _PositionMapPainter extends CustomPainter {
  _PositionMapPainter({
    required this.gameMap,
    this.currentPosition,
    this.liveHeadingDeg,
    required this.debugMode,
    required this.colorScheme,
  });

  final GameMapData gameMap;
  final PositionEstimate? currentPosition;

  /// Live fused heading for the debug arrow (updates without steps).
  /// Falls back to the estimate heading, then north.
  final double? liveHeadingDeg;
  final bool debugMode;
  final ColorScheme colorScheme;

  @override
  void paint(Canvas canvas, Size size) {
    // Calculate bounds and scale
    double minX = double.infinity, maxX = double.negativeInfinity;
    double minY = double.infinity, maxY = double.negativeInfinity;

    for (final node in gameMap.nodes) {
      minX = math.min(minX, node.x);
      maxX = math.max(maxX, node.x);
      minY = math.min(minY, node.y);
      maxY = math.max(maxY, node.y);
    }

    for (final room in gameMap.rooms) {
      for (final p in room.polygon) {
        minX = math.min(minX, p.$1);
        maxX = math.max(maxX, p.$1);
        minY = math.min(minY, p.$2);
        maxY = math.max(maxY, p.$2);
      }
    }

    if (!minX.isFinite) {
      minX = 0;
      maxX = 100;
      minY = 0;
      maxY = 100;
    }

    final padding = 40.0;
    final worldWidth = maxX - minX + padding * 2;
    final worldHeight = maxY - minY + padding * 2;
    final scale = math.min(
      size.width / worldWidth,
      size.height / worldHeight,
    );

    final offsetX = (size.width - worldWidth * scale) / 2 + (padding - minX) * scale;
    final offsetY = (size.height - worldHeight * scale) / 2 + (padding - minY) * scale;

    // Draw corridors
    final corridorPaint = Paint()
      ..color = colorScheme.outlineVariant
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;

    final nodeMap = <String, MapNode>{};
    for (final node in gameMap.nodes) {
      nodeMap[node.id] = node;
    }

    for (final corridor in gameMap.corridors) {
      final a = nodeMap[corridor.a];
      final b = nodeMap[corridor.b];
      if (a == null || b == null) continue;

      canvas.drawLine(
        Offset(a.x * scale + offsetX, a.y * scale + offsetY),
        Offset(b.x * scale + offsetX, b.y * scale + offsetY),
        corridorPaint,
      );
    }

    // Draw rooms
    final roomFillPaint = Paint()..style = PaintingStyle.fill;
    final roomStrokePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;

    for (final room in gameMap.rooms) {
      if (room.polygon.isEmpty) continue;

      final path = Path();
      path.moveTo(
        room.polygon[0].$1 * scale + offsetX,
        room.polygon[0].$2 * scale + offsetY,
      );
      for (int i = 1; i < room.polygon.length; i++) {
        path.lineTo(
          room.polygon[i].$1 * scale + offsetX,
          room.polygon[i].$2 * scale + offsetY,
        );
      }
      path.close();

      final color = roomTypeColor(room.type, colorScheme);
      roomFillPaint.color = color.withValues(alpha: 0.2);
      roomStrokePaint.color = color;

      canvas.drawPath(path, roomFillPaint);
      canvas.drawPath(path, roomStrokePaint);

      // Room label
      final center = room.center;
      final textPainter = TextPainter(
        text: TextSpan(
          text: room.name,
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      textPainter.paint(
        canvas,
        Offset(
          center.x * scale + offsetX - textPainter.width / 2,
          center.y * scale + offsetY - textPainter.height / 2,
        ),
      );
    }

    // Draw corridor nodes
    final nodePaint = Paint()
      ..color = colorScheme.outline
      ..style = PaintingStyle.fill;
    for (final node in gameMap.nodes) {
      canvas.drawCircle(
        Offset(node.x * scale + offsetX, node.y * scale + offsetY),
        4,
        nodePaint,
      );
    }

    // Draw own position marker
    if (currentPosition != null) {
      final px = currentPosition!.x * scale + offsetX;
      final py = currentPosition!.y * scale + offsetY;

      // Outer circle (pulsing effect via confidence)
      final outerPaint = Paint()
        ..color = colorScheme.primary.withValues(alpha: 0.3)
        ..style = PaintingStyle.fill;
      canvas.drawCircle(
        Offset(px, py),
        12 + currentPosition!.confidence * 8,
        outerPaint,
      );

      // Inner circle
      final innerPaint = Paint()
        ..color = colorScheme.primary
        ..style = PaintingStyle.fill;
      canvas.drawCircle(Offset(px, py), 6, innerPaint);

      // Heading arrow (PDR convention: 0 deg = north/up, 90 deg = east/right).
      // This replaces the previous direction line, which used the standard
      // math convention (cos/sin) and therefore pointed 90 deg away from the
      // actual PDR movement direction (sin/-cos).
      paintHeadingArrow(
        canvas,
        center: Offset(px, py),
        headingDeg:
            liveHeadingDeg ?? currentPosition!.heading ?? 0.0,
        color: colorScheme.primary,
        length: 20,
      );

      // "YOU" label
      final labelPainter = TextPainter(
        text: TextSpan(
          text: 'YOU',
          style: TextStyle(
            color: colorScheme.onPrimary,
            fontSize: 10,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      labelPainter.paint(
        canvas,
        Offset(px - labelPainter.width / 2, py - 20),
      );
    }
  }

  @override
  bool shouldRepaint(_PositionMapPainter oldDelegate) =>
      oldDelegate.currentPosition != currentPosition ||
      oldDelegate.liveHeadingDeg != liveHeadingDeg ||
      oldDelegate.debugMode != debugMode;
}

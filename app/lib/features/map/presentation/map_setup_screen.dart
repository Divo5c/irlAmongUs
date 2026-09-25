import 'dart:async';

import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/core/utils/room_roles.dart';
import 'package:real_life_amongus_app/shared/widgets/diagnostics_panel.dart';

import 'map_canvas.dart';

enum _EditorMode { corridor, room }

/// Host-only map editor. The host walks the real building and taps
/// waypoints/corners onto a virtual canvas. Everything is sent to the
/// server as atomic snapshots; the server validates and broadcasts.
///
/// When [positioningService] is provided, "+ Point" captures the
/// current PDR position instead of generating synthetic coordinates.
class MapSetupScreen extends StatefulWidget {
  const MapSetupScreen({
    required this.socketClient,
    required this.roomCode,
    required this.map,
    this.positioningService,
    super.key,
  });

  final RoomSocketClient socketClient;
  final String roomCode;

  /// Latest known map (from the room projection).
  final Map<String, dynamic>? map;

  /// Optional positioning service for real PDR-based corridor scanning.
  /// When null, falls back to manual tap-only mode.
  final PositioningService? positioningService;

  @override
  State<MapSetupScreen> createState() => _MapSetupScreenState();
}

class _MapSetupScreenState extends State<MapSetupScreen> {
  _EditorMode _mode = _EditorMode.corridor;
  final List<Offset> _pendingPoints = <Offset>[];

  GameMapData _working = GameMapData.empty();
  bool _saving = false;
  int _nodeSeq = 0;
  int _roomSeq = 0;

  /// Minimum distance (world units ≈ meters) between consecutive corridor
  /// points. Prevents duplicate points when standing still.
  static const double _minPointDistance = 0.3;

  StreamSubscription? _positionSub;
  StreamSubscription<double>? _headingSub;
  Timer? _diagTimer;
  bool _showDiagnostics = false;

  /// Whether the host has completed calibration.
  bool get _hasCalibration =>
      widget.positioningService?.sensorStatus.calibrationResult != null;

  @override
  void initState() {
    super.initState();
    _working = GameMapData.fromJson(widget.map);
    _nodeSeq = _working.nodes.length;
    _roomSeq = _working.rooms.length;

    // Enable sensor mode so PDR runs during map scanning.
    final pos = widget.positioningService;
    if (pos != null) {
      pos.setInitialPosition(0, 0);
      pos.enableSensorMode();
      _positionSub = pos.positionStream.listen((_) {
        if (mounted) setState(() {});
      });
      // Live heading refreshes the debug arrow independently of PDR steps.
      _headingSub = pos.headingStream.listen((_) {
        if (mounted) setState(() {});
      });
      _diagTimer = Timer.periodic(const Duration(milliseconds: 300), (_) {
        if (mounted && _showDiagnostics) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    _diagTimer?.cancel();
    _positionSub?.cancel();
    _headingSub?.cancel();
    widget.positioningService?.disable();
    super.dispose();
  }

  // ------------------------------------------------------------ helpers //

  /// Current position from the PDR engine, or null if not available.
  Offset? get _currentPdrPosition {
    final est = widget.positioningService?.currentPosition;
    if (est == null) return null;
    return Offset(est.x, est.y);
  }

  /// Live fused heading (degrees) for the debug arrow, independent of steps.
  /// Falls back to the last estimate heading when the fusion has no value
  /// yet; the painter defaults to north when both are null.
  double? get _arrowHeadingDeg =>
      widget.positioningService?.liveHeadingDeg ??
      widget.positioningService?.currentPosition?.heading;

  void _sendUpdate() {
    widget.socketClient.updateMap(
      code: widget.roomCode,
      map: _working.toPayload(),
    );
  }

  void _addPoint(Offset world) {
    // Minimum distance check: skip if too close to last committed point.
    if (_working.nodes.isNotEmpty) {
      final lastNode = _working.nodes.last;
      final dx = world.dx - lastNode.x;
      final dy = world.dy - lastNode.y;
      if (dx * dx + dy * dy < _minPointDistance * _minPointDistance) {
        return;
      }
    }
    // Also check pending points
    if (_pendingPoints.isNotEmpty) {
      final last = _pendingPoints.last;
      final dx = world.dx - last.dx;
      final dy = world.dy - last.dy;
      if (dx * dx + dy * dy < _minPointDistance * _minPointDistance) {
        return;
      }
    }

    setState(() {
      _pendingPoints.add(world);
      if (_mode == _EditorMode.corridor) {
        // Corridor mode commits immediately: connect to the previous point.
        if (_pendingPoints.length >= 2) {
          final prev = _pendingPoints[_pendingPoints.length - 2];
          _commitCorridorSegment(prev, world);
        }
      }
    });
  }

  void _commitCorridorSegment(Offset from, Offset to) {
    final aId = _nearestOrNewNodeId(from);
    final bId = 'n${++_nodeSeq}';
    _working = GameMapData(
      version: _working.version,
      nodes: [
        ..._working.nodes,
        MapNode(id: bId, x: to.dx, y: to.dy),
      ],
      corridors: [
        ..._working.corridors,
        MapCorridor(id: 'c${_working.corridors.length + 1}', a: aId, b: bId),
      ],
      rooms: _working.rooms,
      connections: _working.connections,
    );
  }

  /// Reuses an existing node if the host taps (almost) the same spot again.
  String _nearestOrNewNodeId(Offset world) {
    for (final node in _working.nodes) {
      final dx = node.x - world.dx;
      final dy = node.y - world.dy;
      if (dx * dx + dy * dy < 9) {
        return node.id;
      }
    }
    final id = 'n${++_nodeSeq}';
    _working = GameMapData(
      version: _working.version,
      nodes: [..._working.nodes, MapNode(id: id, x: world.dx, y: world.dy)],
      corridors: _working.corridors,
      rooms: _working.rooms,
      connections: _working.connections,
    );
    return id;
  }

  Future<void> _saveRoomDialog() async {
    if (_pendingPoints.length < 3 || !mounted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Set at least 3 corner points first.'),
        ));
      }
      return;
    }

    var selectedType = 'NORMAL';

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('New Room'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              StatefulBuilder(builder: (context, setDialogState) {
                return DropdownButtonFormField<String>(
                  key: const Key('room-role-dropdown'),
                  initialValue: selectedType,
                  decoration: const InputDecoration(
                      labelText: 'Room type'),
                  items: [
                    for (final type in kRoomTypes)
                      DropdownMenuItem<String>(
                        value: type,
                        child: Row(
                          children: [
                            Icon(roomTypeIcon(type), size: 18),
                            const SizedBox(width: 8),
                            Text(roomTypeLabel(type)),
                          ],
                        ),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() => selectedType = value);
                    }
                  },
                );
              }),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            key: const Key('confirm-save-room'),
            icon: const Icon(Icons.save_rounded),
            label: const Text('Save Room'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
          ),
        ],
      ),
    );

    if (saved != true || !mounted) {
      return; // keep points so the host can retry
    }

    // Auto-name from room type.
    final roomName = roomTypeLabel(selectedType);

    final roomId = 'r${++_roomSeq}';
    var nextMap = GameMapData(
      version: _working.version,
      nodes: _working.nodes,
      corridors: _working.corridors,
      rooms: [
        ..._working.rooms,
        MapRoom(
          id: roomId,
          name: roomName,
          type: selectedType,
          polygon: [
            for (final p in _pendingPoints) (p.dx, p.dy),
          ],
        ),
      ],
      connections: _working.connections,
    );

    // Auto-connect the room to its nearest corridor node ("the door").
    final center = nextMap.rooms.last.center;
    final door = nextMap.nearestNodeTo(center.x, center.y);
    if (door != null) {
      nextMap = GameMapData(
        version: nextMap.version,
        nodes: nextMap.nodes,
        corridors: nextMap.corridors,
        rooms: nextMap.rooms,
        connections: [
          ...nextMap.connections,
          (roomId: roomId, nodeId: door.id),
        ],
      );
    }

    setState(() {
      _working = nextMap;
      _pendingPoints.clear();
    });
    _sendUpdate();
  }

  void _undo() {
    if (_pendingPoints.isNotEmpty) {
      setState(() => _pendingPoints.removeLast());
      return;
    }
    if (_mode == _EditorMode.corridor && _working.corridors.isNotEmpty) {
      // Remove the last corridor and its dangling end node.
      final last = _working.corridors.last;
      final remainingCorridors =
          _working.corridors.sublist(0, _working.corridors.length - 1);
      final stillUsed = remainingCorridors.any((c) => c.b == last.b);
      var nodes = _working.nodes;
      if (!stillUsed) {
        nodes = nodes.where((n) => n.id != last.b).toList();
      }
      setState(() {
        _working = GameMapData(
          version: _working.version,
          nodes: nodes,
          corridors: remainingCorridors,
          rooms: _working.rooms,
          connections: _working.connections
              .where((c) => c.nodeId != last.b)
              .toList(),
        );
        _nodeSeq = nodes.length;
      });
      _sendUpdate();
      return;
    }
    if (_mode == _EditorMode.room && _working.rooms.isNotEmpty) {
      final lastRoom = _working.rooms.last;
      setState(() {
        _working = GameMapData(
          version: _working.version,
          nodes: _working.nodes,
          corridors: _working.corridors,
          rooms:
              _working.rooms.where((r) => r.id != lastRoom.id).toList(),
          connections: _working.connections
              .where((c) => c.roomId != lastRoom.id)
              .toList(),
        );
        _roomSeq = _working.rooms.length;
      });
      _sendUpdate();
    }
  }

  Future<void> _saveWholeMap() async {
    if (_pendingPoints.length >= 3 && _mode == _EditorMode.room) {
      await _saveRoomDialog();
      if (_pendingPoints.isNotEmpty) {
        return; // dialog cancelled -> keep editing
      }
    }
    if (!mounted) {
      return;
    }
    if (_working.rooms.isEmpty && _working.corridors.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content:
            Text('Add at least one corridor with two points before saving.'),
      ));
      return;
    }
    setState(() => _saving = true);
    widget.socketClient.saveMap(code: widget.roomCode, map: _working.toPayload());
  }

  // -------------------------------------------------------------- build //

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final pos = widget.positioningService;
    final hasSensors = pos != null;
    final currentPos = _currentPdrPosition;
    final nodeCount = _working.nodes.length;
    final corridorCount = _working.corridors.length;

    return SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SegmentedButton<_EditorMode>(
              segments: const [
                ButtonSegment(
                  value: _EditorMode.corridor,
                  icon: Icon(Icons.route_rounded),
                  label: Text('Corridor'),
                ),
                ButtonSegment(
                  value: _EditorMode.room,
                  icon: Icon(Icons.square_foot_rounded),
                  label: Text('Room'),
                ),
              ],
              selected: {_mode},
              onSelectionChanged: (selection) {
                setState(() {
                  _mode = selection.first;
                });
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Text(
                    _scanningHint(hasSensors, nodeCount),
                    style: textTheme.bodyMedium,
                  ),
                ),
                Text(
                  '$corridorCount corridors · ${_working.rooms.length} rooms',
                  key: const Key('editor-status'),
                  style: textTheme.bodySmall,
                ),
              ],
            ),
          ),
          // Compact diagnostics bar + diagnostics toggle
          if (hasSensors)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Row(
                children: [
                  Icon(
                    pos.isSensorMode ? Icons.sensors_rounded : Icons.sensors_off_rounded,
                    size: 12,
                    color: pos.isSensorMode ? Colors.green : Colors.orange,
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${currentPos != null ? '(${currentPos.dx.toStringAsFixed(1)}, ${currentPos.dy.toStringAsFixed(1)})' : '—'}'
                      '  ·  ${pos.sensorStatus.stepCount} steps'
                      '  ·  ${_hasCalibration ? "calibrated" : "default stride"}',
                      key: const Key('position-diagnostics'),
                      style: textTheme.bodySmall?.copyWith(fontFamily: 'monospace', fontSize: 10),
                    ),
                  ),
                  IconButton(
                    key: const Key('diagnostics-toggle'),
                    icon: const Icon(Icons.info_outline, size: 16),
                    tooltip: 'Diagnostics',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    onPressed: () => setState(() => _showDiagnostics = !_showDiagnostics),
                  ),
                ],
              ),
            ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Container(
                  color: Theme.of(context)
                      .colorScheme
                      .surfaceContainerHighest
                      .withValues(alpha: 0.35),
                  child: MapCanvas(
                    key: const Key('map-canvas'),
                    map: _working,
                    pendingPoints: _pendingPoints,
                    pendingModeIsRoom: _mode == _EditorMode.room,
                    hostPosition: currentPos,
                    hostHeadingDeg: _arrowHeadingDeg,
                    onTapWorld: (x, y) => _addPoint(Offset(x, y)),
                  ),
                ),
              ),
            ),
          ),
          if (_showDiagnostics && hasSensors)
            SizedBox(
              height: 380,
              child: SingleChildScrollView(
                child: DiagnosticsPanel(
                  currentPosition: pos.currentPosition,
                  gameMap: _working,
                  sensorStatus: pos.sensorStatus,
                  stepLog: pos.stepLog,
                  onCalibrate: null,
                  onResetPosition: () {
                    pos.resetPosition();
                    setState(() {});
                  },
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('map-undo-button'),
                    onPressed: _pendingPoints.isEmpty &&
                            ((_mode == _EditorMode.corridor &&
                                    _working.corridors.isEmpty) ||
                                (_mode == _EditorMode.room &&
                                    _working.rooms.isEmpty))
                        ? null
                        : _undo,
                    icon: const Icon(Icons.undo_rounded),
                    label: const Text('Undo'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: _mode == _EditorMode.corridor
                      ? FilledButton.icon(
                          key: const Key('add-point-button'),
                          onPressed: _onAddPointPressed,
                          icon: const Icon(Icons.add_location_alt_rounded),
                          label: const Text('+ Point'),
                        )
                      : FilledButton.icon(
                          key: const Key('save-room-button'),
                          onPressed: _saveRoomDialog,
                          icon: const Icon(Icons.save_rounded),
                          label: const Text('Save Room'),
                        ),
                ),
                const SizedBox(width: 12),
                FilledButton.tonalIcon(
                  key: const Key('finish-map-button'),
                  onPressed: _saving ? null : _saveWholeMap,
                  icon: _saving
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.check_circle_outline_rounded),
                  label: const Text('Finish'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Context-sensitive scanning hint.
  String _scanningHint(bool hasSensors, int nodeCount) {
    if (_mode == _EditorMode.room) {
      return 'Tap the corners of the room';
    }
    if (!hasSensors) {
      return 'Tap waypoints along your corridor';
    }
    if (nodeCount == 0) {
      return 'Start walking and place your first waypoint';
    }
    return 'Walk to the next corner and tap + Point';
  }

  /// "+ Point" captures the current PDR position when sensors are active.
  ///
  /// Returns null when sensors are active but no position is known yet —
  /// fabricating a point there would create phantom geometry.
  Offset? _nextAutoPoint() {
    // Use real PDR position if available.
    final pos = _currentPdrPosition;
    if (pos != null) {
      return pos;
    }
    if (widget.positioningService == null) {
      // Manual testing mode without sensors: synthetic linear layout.
      if (_pendingPoints.isEmpty) {
        return const Offset(0, 0);
      }
      final last = _pendingPoints.last;
      return Offset(last.dx + 60, last.dy);
    }
    return null;
  }

  void _onAddPointPressed() {
    final point = _nextAutoPoint();
    if (point == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Waiting for position... walk a few steps first.'),
      ));
      return;
    }
    _addPoint(point);
  }
}

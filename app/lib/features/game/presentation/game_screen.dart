import 'dart:async';

import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/core/positioning/android_sensor_provider.dart';
import 'package:real_life_amongus_app/core/positioning/positioning_service.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_ready_view.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_setup_screen.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_waiting_view.dart';
import 'package:real_life_amongus_app/features/map/presentation/position_map_view.dart';
import 'package:real_life_amongus_app/shared/widgets/game_settings_panel.dart';
import 'package:real_life_amongus_app/shared/widgets/room_lobby_details.dart';

import 'game_over_view.dart';
import 'meeting_view.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({
    required this.socketClient,
    required this.playerId,
    required this.roomCode,
    this.initialRoom,
    super.key,
  });

  final RoomSocketClient socketClient;
  final String playerId;
  final String roomCode;

  /// Latest known public room state. Events broadcast before this screen
  /// subscribed would otherwise be missed.
  final Map<String, dynamic>? initialRoom;

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final Set<String> _completedTaskIds = <String>{};
  final List<StreamSubscription<Map<String, dynamic>>> _subscriptions =
      <StreamSubscription<Map<String, dynamic>>>[];
  StreamSubscription<RoomSocketException>? _errorSubscription;
  StreamSubscription<bool>? _connectionSubscription;

  Map<String, dynamic>? _room;
  Map<String, dynamic>? _assignment;
  Map<String, dynamic>? _meeting;
  Map<String, dynamic>? _meetingResult;
  Map<String, dynamic>? _gameOver;

  /// Drives countdown displays (kill cooldown). Ticks once per second.
  Timer? _secondTicker;

  /// Whether to show the position map view during IN_GAME.
  bool _showPositionMap = false;
  bool _isConnected = false;

  /// Admin tracking state (host only).
  bool _adminTrackingEnabled = false;
  List<Map<String, dynamic>> _adminPlayerPositions = [];

  /// Shared positioning service for map scanning (host only).
  /// Created when the host enters MAP_SETUP; disposed on screen dispose.
  PositioningService? _scanPositioning;

  @override
  void initState() {
    super.initState();

    _room = widget.initialRoom;
    _isConnected = widget.socketClient.isConnected;

    // Role assignments and game over events may arrive before this screen is
    // built (navigation race), so cached values are used as initial state.
    final cachedAssignment = widget.socketClient.latestRoleAssignment;
    if (cachedAssignment != null &&
        cachedAssignment['code'] == widget.roomCode) {
      _assignment = cachedAssignment;
    }
    final cachedGameOver = widget.socketClient.latestGameOver;
    if (cachedGameOver != null && cachedGameOver['code'] == widget.roomCode) {
      _gameOver = cachedGameOver;
    }

    _subscriptions.add(
      widget.socketClient.roomUpdates.listen(_handleRoomUpdate),
    );
    _connectionSubscription = widget.socketClient.connectionStateChanges.listen(
      (connected) {
        if (mounted) setState(() => _isConnected = connected);
      },
    );
    _subscriptions.add(
      widget.socketClient.roleAssignments.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          setState(() => _assignment = event);
        }
      }),
    );
    _subscriptions.add(
      widget.socketClient.taskProgressUpdates.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          final completedTaskId = event['completedTaskId'];
          if (completedTaskId is String) {
            setState(() => _completedTaskIds.add(completedTaskId));
          }
        }
      }),
    );
    _subscriptions.add(
      widget.socketClient.killUpdates.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('${event['killedPlayerId']} was killed.')),
          );
        }
      }),
    );
    _subscriptions.add(
      widget.socketClient.meetingUpdates.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          setState(() => _meeting = event);
        }
      }),
    );
    _subscriptions.add(
      widget.socketClient.meetingResults.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          final ejectedId = event['ejectedPlayerId'];
          final ejectedName = event['ejectedPlayerName'];
          setState(() => _meetingResult = event);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                ejectedId is String
                    ? (ejectedName is String && ejectedName.isNotEmpty)
                          ? '$ejectedName was ejected.'
                          : 'A player was ejected.'
                    : 'Nobody was ejected.',
              ),
            ),
          );
        }
      }),
    );
    _subscriptions.add(
      widget.socketClient.gameOverUpdates.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          setState(() => _gameOver = event);
        }
      }),
    );
    _errorSubscription = widget.socketClient.errors.listen((error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    });

    // Admin position tracking (host only)
    _subscriptions.add(
      widget.socketClient.adminPositions.listen((event) {
        if (event['code'] == widget.roomCode && mounted) {
          final positions = event['positions'];
          if (positions is List) {
            setState(() {
              _adminPlayerPositions = positions
                  .whereType<Map>()
                  .map(Map<String, dynamic>.from)
                  .toList();
            });
          }
        }
      }),
    );

    // One tick per second keeps every countdown (kill cooldown, meeting
    // timers) fresh without extra per-widget timers.
    _secondTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _secondTicker?.cancel();
    for (final subscription in _subscriptions) {
      subscription.cancel();
    }
    _errorSubscription?.cancel();
    _connectionSubscription?.cancel();
    _scanPositioning?.dispose();
    super.dispose();
  }

  void _handleRoomUpdate(Map<String, dynamic> room) {
    if (room['code'] != widget.roomCode || !mounted) {
      return;
    }
    setState(() {
      _room = room;
      if (room['status'] == 'LOBBY') {
        // A rematch sent us back to the lobby: discard all round state.
        _assignment = null;
        _meeting = null;
        _meetingResult = null;
        _gameOver = null;
        _completedTaskIds.clear();
        widget.socketClient.clearRoundCaches();
      } else if (room['status'] != 'MEETING' && _meetingResult != null) {
        _meetingResult = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final room = _room;
    final status = room?['status'] as String?;

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          title: Text(_titleFor(status)),
          actions: [
            IconButton(
              key: const Key('leave-room-button'),
              tooltip: 'Leave room',
              icon: const Icon(Icons.logout_rounded),
              onPressed: () =>
                  Navigator.of(context).popUntil((route) => route.isFirst),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              if (!_isConnected)
                Container(
                  width: double.infinity,
                  color: Theme.of(context).colorScheme.errorContainer,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.wifi_off_rounded, size: 18),
                      SizedBox(width: 8),
                      Expanded(child: Text('Connection lost. Reconnecting…')),
                      SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: room == null
                    ? const Center(child: CircularProgressIndicator())
                    : _buildForStatus(room),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _titleFor(String? status) {
    switch (status) {
      case 'MAP_SETUP':
        return 'Map Setup';
      case 'MAP_READY':
        return 'Map Ready';
      case 'MEETING':
        return 'Meeting';
      case 'GAME_OVER':
        return 'Game Over';
      default:
        return 'Lobby';
    }
  }

  Widget _buildForStatus(Map<String, dynamic> room) {
    final status = room['status'] as String? ?? 'IN_GAME';
    switch (status) {
      case 'LOBBY':
        return _buildLobbyView(context, room);
      case 'MAP_SETUP':
        if (_isHost(room)) {
          // Lazily create positioning service for map scanning.
          _scanPositioning ??= PositioningService(
            map: room['map'] is Map
                ? GameMapData.fromJson(
                    Map<String, dynamic>.from(room['map'] as Map),
                  )
                : null,
            sensorProvider: AndroidSensorProvider(),
          );
          return MapSetupScreen(
            socketClient: widget.socketClient,
            roomCode: widget.roomCode,
            map: room['map'] is Map
                ? Map<String, dynamic>.from(room['map'] as Map)
                : null,
            positioningService: _scanPositioning,
          );
        }
        return MapWaitingView(mapExists: room['map'] != null);
      case 'MAP_READY':
        return MapReadyView(
          socketClient: widget.socketClient,
          roomCode: widget.roomCode,
          room: room,
          playerId: widget.playerId,
          players: _players(room),
        );
      case 'GAME_OVER':
        return GameOverView(
          gameOver: _gameOver,
          room: room,
          isHost: _isHost(room),
          onBackToLobby: () =>
              widget.socketClient.requestReset(code: widget.roomCode),
        );
      case 'MEETING':
        final players = _players(room);
        return MeetingView(
          key: const Key('meeting-view'),
          players: players,
          playerId: widget.playerId,
          phase: (room['meetingPhase'] as String?) ?? 'VOTING',
          reporterId:
              (_meeting?['reporterId'] ?? room['reporterId']) as String?,
          discussionDeadlineMs: _deadlineMs(room, const ['discussionDeadline']),
          votingDeadlineMs: _deadlineMs(room, const [
            'votingDeadline',
            'discussionDeadline',
          ]),
          votedCount: room['votedCount'] is num
              ? (room['votedCount'] as num).toInt()
              : 0,
          totalVoters: players.where((player) => _isAlive(player)).length,
          canVote: _selfIsAlive(players),
          result: _meetingResult,
          onVote: (targetId) => widget.socketClient.castVote(
            code: widget.roomCode,
            targetId: targetId,
          ),
          onSkip: () =>
              widget.socketClient.castVote(code: widget.roomCode, skip: true),
          onContinue: () {
            if (mounted) {
              setState(() => _meetingResult = null);
            }
          },
        );
      default:
        return _buildGameView(context, room);
    }
  }

  bool _isHost(Map<String, dynamic> room) => room['hostId'] == widget.playerId;

  int? _deadlineMs(Map<String, dynamic> room, List<String> keys) {
    for (final key in keys) {
      final dynamic fromEvent = _meeting?[key];
      if (fromEvent is String) {
        return DateTime.tryParse(fromEvent)?.millisecondsSinceEpoch;
      }
      final dynamic fromRoom = room[key];
      if (fromRoom is String) {
        return DateTime.tryParse(fromRoom)?.millisecondsSinceEpoch;
      }
    }
    return null;
  }

  /// Lobby state inside the game screen: shown after creation (host) and
  /// after a rematch. Host sees editable settings + start button.
  Widget _buildLobbyView(BuildContext context, Map<String, dynamic> room) {
    final textTheme = Theme.of(context).textTheme;
    final isHost = _isHost(room);

    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Waiting Lobby',
                  textAlign: TextAlign.center,
                  style: textTheme.headlineSmall,
                ),
                const SizedBox(height: 4),
                Text(
                  'Room code: ${room['code'] ?? widget.roomCode}',
                  key: const Key('lobby-room-code'),
                  textAlign: TextAlign.center,
                  style: textTheme.titleMedium?.copyWith(letterSpacing: 4),
                ),
                const SizedBox(height: 16),
                RoomLobbyDetails(room: room, playerId: widget.playerId),
                const SizedBox(height: 16),
                GameSettingsPanel(
                  config: room['config'] is Map
                      ? Map<String, dynamic>.from(room['config'] as Map)
                      : const {},
                  playerCount: _players(room).length,
                  readOnly: !isHost,
                  onChanged: (patch) => widget.socketClient.updateConfig(
                    code: widget.roomCode,
                    config: patch,
                  ),
                ),
                const SizedBox(height: 24),
                if (isHost)
                  FilledButton.icon(
                    key: const Key('setup-map-button'),
                    onPressed: () => widget.socketClient.startMapSetup(
                      code: widget.roomCode,
                    ),
                    icon: const Icon(Icons.architecture_rounded),
                    label: const Text('Setup Map'),
                  ),
                if (!isHost)
                  Text(
                    'Waiting for the host to continue...',
                    textAlign: TextAlign.center,
                    style: textTheme.bodySmall,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildGameView(BuildContext context, Map<String, dynamic> room) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final players = _players(room);
    final tasks = _tasks;
    final progress = room['taskProgress'];
    final completedCount = progress is Map
        ? (progress['completed'] as num? ?? 0)
        : 0;
    final totalCount = progress is Map ? (progress['total'] as num? ?? 0) : 0;
    final selfIsAlive = _selfIsAlive(players);
    final role = _role;
    final isHost = _isHost(room);

    // If position map view is active, show it instead of the task view
    if (_showPositionMap) {
      return Column(
        children: [
          // Top bar with toggle back
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            color: colorScheme.surfaceContainerHighest,
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back),
                  tooltip: 'Back to game',
                  onPressed: () => setState(() => _showPositionMap = false),
                ),
                const Expanded(
                  child: Text(
                    'Position Map',
                    style: TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                // Admin tracking toggle (host only)
                if (isHost)
                  IconButton(
                    key: const Key('admin-tracking-toggle'),
                    icon: Icon(
                      _adminTrackingEnabled
                          ? Icons.visibility
                          : Icons.visibility_off,
                      color: _adminTrackingEnabled ? colorScheme.error : null,
                    ),
                    tooltip: _adminTrackingEnabled
                        ? 'Disable admin tracking'
                        : 'Enable admin tracking (host only)',
                    onPressed: _toggleAdminTracking,
                  ),
              ],
            ),
          ),
          // Position map view
          Expanded(
            child: PositionMapView(
              socketClient: widget.socketClient,
              roomCode: widget.roomCode,
              playerId: widget.playerId,
              room: room,
            ),
          ),
          // Admin player list (if tracking enabled)
          if (_adminTrackingEnabled && _adminPlayerPositions.isNotEmpty)
            Container(
              height: 80,
              padding: const EdgeInsets.all(8),
              color: colorScheme.surfaceContainerHighest,
              child: ListView(
                children: [
                  for (final pos in _adminPlayerPositions)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        '${pos['name'] ?? pos['playerId']}: '
                        '(${(pos['x'] as num?)?.toStringAsFixed(1) ?? "?"}, '
                        '${(pos['y'] as num?)?.toStringAsFixed(1) ?? "?"}) '
                        '${pos['roomId'] != null ? '[${pos['roomId']}]' : ''}',
                        style: textTheme.bodySmall,
                      ),
                    ),
                ],
              ),
            ),
        ],
      );
    }

    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Position map toggle button
                OutlinedButton.icon(
                  key: const Key('show-position-map-button'),
                  onPressed: () => setState(() => _showPositionMap = true),
                  icon: const Icon(Icons.map_rounded),
                  label: const Text('Show Position Map'),
                ),
                const SizedBox(height: 16),
                Card(
                  color: role == 'IMPOSTOR' ? colorScheme.errorContainer : null,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(
                          role == 'IMPOSTOR'
                              ? Icons.visibility_off_rounded
                              : Icons.engineering_rounded,
                          size: 36,
                          color: role == 'IMPOSTOR'
                              ? colorScheme.error
                              : colorScheme.primary,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            role == null
                                ? 'Waiting for your role...'
                                : 'You are $role',
                            key: const Key('own-role-text'),
                            style: textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text('Players (${players.length})'),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final player in players)
                      Chip(
                        avatar: Icon(
                          player['isAlive'] == false
                              ? Icons.person_off_outlined
                              : Icons.person_outline,
                          size: 18,
                        ),
                        label: Text(_playerLabel(player)),
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Your tasks', style: textTheme.titleMedium),
                    Text('$completedCount / $totalCount done'),
                  ],
                ),
                const SizedBox(height: 8),
                if (tasks.isEmpty)
                  Text(
                    role == 'IMPOSTOR'
                        ? 'Impostors have no tasks. Sabotage wisely.'
                        : 'No tasks assigned.',
                    style: textTheme.bodyMedium,
                  )
                else
                  for (final task in tasks)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text('${task['title'] ?? task['id']}'),
                          ),
                          FilledButton.tonal(
                            onPressed: _completedTaskIds.contains(task['id'])
                                ? null
                                : () => _completeTask(task['id']),
                            child: const Text('Done'),
                          ),
                        ],
                      ),
                    ),
                const SizedBox(height: 32),
                OutlinedButton.icon(
                  key: const Key('report-button'),
                  onPressed: selfIsAlive ? _reportBody : null,
                  icon: const Icon(Icons.campaign_rounded),
                  label: const Text('Report Body'),
                ),
                if (_isImpostor && selfIsAlive) ...[
                  const SizedBox(height: 12),
                  _buildKillButton(context, room),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildKillButton(BuildContext context, Map<String, dynamic> room) {
    final colorScheme = Theme.of(context).colorScheme;
    final dynamic rawReadyAt = room['killReadyAt'];
    final killReadyAt = rawReadyAt is num ? rawReadyAt.toInt() : 0;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final remainingMs = killReadyAt > nowMs ? killReadyAt - nowMs : 0;
    final ready = remainingMs <= 0;

    return FilledButton.icon(
      key: const Key('kill-button'),
      style: FilledButton.styleFrom(
        backgroundColor: colorScheme.error,
        foregroundColor: colorScheme.onError,
      ),
      // The SERVER decides whether a kill is allowed; this is pure UX.
      onPressed: ready ? _showKillDialog : null,
      icon: Icon(ready ? Icons.dangerous_rounded : Icons.hourglass_top_rounded),
      label: Text(
        ready ? 'Kill' : 'Cooldown ${((remainingMs + 999) ~/ 1000)}s',
      ),
    );
  }

  String _playerLabel(Map<String, dynamic> player) {
    final name =
        player['name'] is String && (player['name'] as String).isNotEmpty
        ? player['name'] as String
        : '${player['id']}';
    final suffix = player['id'] == widget.playerId
        ? ' (You)'
        : player['isAlive'] == false
        ? ' (dead)'
        : '';
    return '$name$suffix';
  }

  bool get _isImpostor => _role == 'IMPOSTOR';

  String? get _role {
    final role = _assignment?['role'];
    return role is String ? role : null;
  }

  List<Map<String, dynamic>> get _tasks {
    final tasks = _assignment?['tasks'];
    if (tasks is List) {
      return tasks.whereType<Map>().map(Map<String, dynamic>.from).toList();
    }
    return const [];
  }

  List<Map<String, dynamic>> _players(Map<String, dynamic> room) {
    final players = room['players'];
    if (players is List) {
      return players.whereType<Map>().map(Map<String, dynamic>.from).toList();
    }
    return const [];
  }

  bool _isAlive(Map<String, dynamic> player) => player['isAlive'] != false;

  bool _selfIsAlive(List<Map<String, dynamic>> players) {
    for (final player in players) {
      if (player['id'] == widget.playerId) {
        return _isAlive(player);
      }
    }
    return true;
  }

  void _completeTask(Object? taskId) {
    if (taskId is! String) {
      return;
    }
    setState(() => _completedTaskIds.add(taskId));
    widget.socketClient.completeTask(code: widget.roomCode, taskId: taskId);
  }

  void _reportBody() {
    widget.socketClient.reportBody(code: widget.roomCode);
  }

  void _toggleAdminTracking() {
    if (_adminTrackingEnabled) {
      setState(() {
        _adminTrackingEnabled = false;
        _adminPlayerPositions = [];
      });
    } else {
      // Show PIN dialog
      _showAdminPinDialog();
    }
  }

  Future<void> _showAdminPinDialog() async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Admin Tracking'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            labelText: 'Admin PIN',
            hintText: 'Enter room code as PIN',
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: const Text('Authenticate'),
          ),
        ],
      ),
    );

    if (result != null && result.isNotEmpty) {
      widget.socketClient.authenticateAdmin(code: widget.roomCode, pin: result);
      // Wait briefly for auth response, then enable if successful
      await Future<void>.delayed(const Duration(milliseconds: 500));
      // The server will send admin:positions if auth succeeds
      widget.socketClient.requestAdminPositions(code: widget.roomCode);
      setState(() => _adminTrackingEnabled = true);
    }
  }

  Future<void> _showKillDialog() async {
    final targets = _players(_room ?? const {})
        .where(
          (player) =>
              player['id'] != widget.playerId && player['isAlive'] != false,
        )
        .toList();

    if (!mounted) {
      return;
    }
    if (targets.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('No targets available.')));
      return;
    }

    final targetId = await showDialog<String>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: const Text('Choose a target'),
        children: [
          for (final target in targets)
            SimpleDialogOption(
              onPressed: () =>
                  Navigator.of(dialogContext).pop(target['id'] as String?),
              child: Text('${target['name'] ?? target['id']}'),
            ),
        ],
      ),
    );

    if (targetId != null) {
      widget.socketClient.killPlayer(
        code: widget.roomCode,
        targetPlayerId: targetId,
      );
    }
  }
}

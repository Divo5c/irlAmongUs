import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/features/game/presentation/game_screen.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_ready_view.dart';
import 'package:real_life_amongus_app/features/map/presentation/map_setup_screen.dart';
import 'package:real_life_amongus_app/shared/widgets/game_settings_panel.dart';
import 'package:real_life_amongus_app/main.dart';

class FakeRoomSocketClient implements RoomSocketClient {
  final _roomUpdates = StreamController<Map<String, dynamic>>.broadcast();
  final _roleAssignments = StreamController<Map<String, dynamic>>.broadcast();
  final _meetingResults = StreamController<Map<String, dynamic>>.broadcast();
  final _votingStarted = StreamController<Map<String, dynamic>>.broadcast();
  final _errors = StreamController<RoomSocketException>.broadcast();
  final _connectionStateChanges = StreamController<bool>.broadcast();
  bool connected = true;

  final completedTaskIds = <String>[];
  final killedTargets = <String>[];
  final castVotes = <String>[];
  final configPatches = <Map<String, dynamic>>[];
  final mapUpdates = <Map<String, dynamic>>[];
  final mapSaves = <Map<String, dynamic>?>[];
  final positionUpdates = <Map<String, dynamic>>[];
  int resetRequests = 0;
  int gamesStarted = 0;
  int mapSetupsStarted = 0;
  int mapEdits = 0;
  String? _hostId;
  String? _hostName;

  @override
  Map<String, dynamic>? latestRoleAssignment;
  @override
  Map<String, dynamic>? latestGameOver;

  @override
  Stream<Map<String, dynamic>> get roomUpdates => _roomUpdates.stream;

  @override
  Stream<Map<String, dynamic>> get roleAssignments => _roleAssignments.stream;

  @override
  Stream<Map<String, dynamic>> get taskProgressUpdates =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get meetingUpdates =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get killUpdates =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get voteProgressUpdates =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get meetingResults => _meetingResults.stream;

  @override
  Stream<Map<String, dynamic>> get votingStartedUpdates =>
      _votingStarted.stream;

  final _mapSaved = StreamController<Map<String, dynamic>>.broadcast();
  @override
  Stream<Map<String, dynamic>> get mapSaved => _mapSaved.stream;

  @override
  Stream<Map<String, dynamic>> get positionConfirmed =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get positionErrors =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get adminAuthResults =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<Map<String, dynamic>> get adminPositions =>
      Stream<Map<String, dynamic>>.empty();

  void emitMapSaved(Map<String, dynamic> event) => _mapSaved.add(event);

  void emitMeetingResult(Map<String, dynamic> result) =>
      _meetingResults.add(result);

  void emitVotingStarted(Map<String, dynamic> event) =>
      _votingStarted.add(event);

  void emitRole(Map<String, dynamic> assignment) {
    latestRoleAssignment = assignment;
    _roleAssignments.add(assignment);
  }

  @override
  Stream<Map<String, dynamic>> get gameOverUpdates =>
      Stream<Map<String, dynamic>>.empty();

  @override
  Stream<RoomSocketException> get errors => _errors.stream;

  @override
  Stream<bool> get connectionStateChanges => _connectionStateChanges.stream;

  @override
  bool get isConnected => connected;

  void seedRole({
    required String code,
    required String playerId,
    required String role,
    List<Map<String, dynamic>> tasks = const [],
  }) {
    latestRoleAssignment = {
      'code': code,
      'playerId': playerId,
      'role': role,
      'tasks': tasks,
    };
  }

  void emitRoom(Map<String, dynamic> room) => _roomUpdates.add(room);

  @override
  Future<Map<String, dynamic>> createRoom({
    required String code,
    required String hostId,
    required String hostName,
  }) async {
    _hostId = hostId;
    _hostName = hostName;
    return _room(code, hostId, hostName, isHost: true);
  }

  @override
  Future<Map<String, dynamic>> joinRoom({
    required String code,
    required String playerId,
    required String playerName,
  }) async {
    final room = _room(code, playerId, playerName);
    _roomUpdates.add(room);
    return room;
  }

  @override
  Future<Map<String, dynamic>> startGame({required String code}) async {
    gamesStarted += 1;
    final hostId = _hostId ?? 'host-1';
    final hostName = _hostName ?? 'Host';
    final room = {
      'code': code,
      'status': 'IN_GAME',
      'hostId': hostId,
      'players': [
        {'id': hostId, 'name': hostName, 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    };
    seedRole(code: code, playerId: hostId, role: 'IMPOSTOR');
    _roleAssignments.add(latestRoleAssignment!);
    _roomUpdates.add(room);
    return room;
  }

  @override
  void completeTask({required String code, required String taskId}) {
    completedTaskIds.add(taskId);
  }

  @override
  void reportBody({required String code}) {}

  @override
  void killPlayer({required String code, required String targetPlayerId}) {
    killedTargets.add(targetPlayerId);
  }

  @override
  void castVote({required String code, String? targetId, bool skip = false}) {
    castVotes.add(skip ? 'skip' : targetId!);
  }

  @override
  void updateConfig({
    required String code,
    required Map<String, dynamic> config,
  }) {
    configPatches.add(config);
  }

  @override
  void requestReset({required String code}) {
    resetRequests += 1;
  }

  @override
  void startMapSetup({required String code}) {
    mapSetupsStarted += 1;
  }

  @override
  void updateMap({required String code, required Map<String, dynamic> map}) {
    mapUpdates.add(map);
  }

  @override
  void saveMap({required String code, Map<String, dynamic>? map}) {
    mapSaves.add(map);
  }

  @override
  void editMap({required String code}) {
    mapEdits += 1;
  }

  @override
  void sendPositionUpdate({
    required String code,
    required double x,
    required double y,
    double? heading,
    double confidence = 0.5,
    String source = 'FUSED',
  }) {
    positionUpdates.add({
      'code': code,
      'x': x,
      'y': y,
      'heading': heading,
      'confidence': confidence,
      'source': source,
    });
  }

  @override
  void authenticateAdmin({required String code, required String pin}) {}

  @override
  void setAdminPin({required String code, required String pin}) {}

  @override
  Stream<Map<String, dynamic>> get adminPinSetResults =>
      Stream<Map<String, dynamic>>.empty();

  @override
  void requestAdminPositions({required String code}) {}

  @override
  void clearRoundCaches() {
    latestRoleAssignment = null;
    latestGameOver = null;
  }

  @override
  void dispose() {
    _roomUpdates.close();
    _roleAssignments.close();
    _meetingResults.close();
    _errors.close();
    _connectionStateChanges.close();
    _mapSaved.close();
  }

  Map<String, dynamic> _room(
    String code,
    String playerId,
    String playerName, {
    bool isHost = false,
  }) => {
    'code': code,
    'status': 'LOBBY',
    'hostId': isHost ? playerId : 'host-1',
    // Public rooms never contain roles.
    'players': [
      {'id': playerId, 'name': playerName, 'isAlive': true, 'isHost': isHost},
    ],
    'taskProgress': {'completed': 0, 'total': 0},
  };
}

void main() {
  testWidgets('shows the home screen actions', (tester) async {
    await tester.pumpWidget(
      RealLifeAmongUsApp(socketClient: FakeRoomSocketClient()),
    );

    expect(find.text('Real Life Among Us'), findsOneWidget);
    expect(find.text('Host Game'), findsOneWidget);
    expect(find.text('Join Game'), findsOneWidget);
  });

  testWidgets('shows a reconnecting banner when the game socket drops', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();
    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-1',
          roomCode: 'ABC234',
          initialRoom: {
            'code': 'ABC234',
            'status': 'LOBBY',
            'hostId': 'host-1',
            'players': [
              {'id': 'host-1', 'name': 'Host', 'isAlive': true, 'isHost': true},
            ],
            'taskProgress': {'completed': 0, 'total': 0},
          },
        ),
      ),
    );

    client._connectionStateChanges.add(false);
    await tester.pump();
    expect(find.text('Connection lost. Reconnecting…'), findsOneWidget);
  });

  testWidgets('host lands directly in the lobby after creating a room', (
    tester,
  ) async {
    await tester.pumpWidget(
      RealLifeAmongUsApp(socketClient: FakeRoomSocketClient()),
    );

    await tester.tap(find.text('Host Game'));
    await tester.pumpAndSettle();

    expect(find.byType(GameScreen), findsOneWidget);
    expect(find.byKey(const Key('lobby-room-code')), findsOneWidget);
    expect(find.text('LOBBY'), findsOneWidget);
    expect(find.text('Host (You)'), findsOneWidget);
    // The host continues to the map setup from here:
    expect(find.byKey(const Key('setup-map-button')), findsOneWidget);
  });

  testWidgets('setup map -> editor for host -> game state shows role', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();
    client.seedRole(code: 'ABC234', playerId: 'host-x', role: 'IMPOSTOR');

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );

    // Lobby first (room projection arrives):
    client.emitRoom({
      'code': 'ABC234',
      'status': 'LOBBY',
      'hostId': 'host-x',
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    // Host opens map setup:
    await tester.ensureVisible(find.byKey(const Key('setup-map-button')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('setup-map-button')));
    await tester.pump();
    expect(client.mapSetupsStarted, 1);

    // Fake emits the authoritative MAP_SETUP room:
    client.emitRoom({
      'code': 'ABC234',
      'status': 'MAP_SETUP',
      'hostId': 'host-x',
      'config': {'impostorCount': 1},
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    expect(find.byType(MapSetupScreen), findsOneWidget);
    expect(find.byKey(const Key('map-canvas')), findsOneWidget);

    // Scan origin is published immediately: diagnostics shows (0.0, 0.0).
    expect(find.textContaining('(0.0, 0.0)'), findsOneWidget);
    // Corridor mode while standing still: first +Point stores the origin,
    // second +Point at the same spot is rejected — no phantom corridor.
    await tester.tap(find.byKey(const Key('add-point-button')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('add-point-button')));
    await tester.pump();
    expect(find.textContaining('0 corridors'), findsOneWidget);
    await tester.tap(find.byKey(const Key('map-undo-button')));
    await tester.pump();
    expect(find.textContaining('0 corridors'), findsOneWidget);

    // The server would require a saved map first; simulate the finished
    // round-trip by jumping straight into the game:
    client.emitRoom({
      'code': 'ABC234',
      'status': 'IN_GAME',
      'hostId': 'host-x',
      'killReadyAt': 0,
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    // Fresh private role for the new round arrives right after the state:
    client.emitRole({
      'code': 'ABC234',
      'playerId': 'host-x',
      'role': 'IMPOSTOR',
      'teammates': [],
      'tasks': [],
      'killReadyAt': 0,
    });
    await tester.pump();
    await tester.pump();

    expect(find.text('You are IMPOSTOR'), findsOneWidget);
    expect(find.byKey(const Key('kill-button')), findsOneWidget);
  });

  testWidgets('non-host sees waiting state during MAP_SETUP', (tester) async {
    final client = FakeRoomSocketClient();

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'p9',
          roomCode: 'ABC234',
        ),
      ),
    );
    client.emitRoom({
      'code': 'ABC234',
      'status': 'MAP_SETUP',
      'hostId': 'host-x',
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
        {'id': 'p9', 'name': 'Me', 'isAlive': true, 'isHost': false},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('map-waiting-indicator')), findsOneWidget);
    expect(find.textContaining('host is setting up'), findsOneWidget);
    // Non-hosts never see editor or start controls:
    expect(find.byKey(const Key('map-canvas')), findsNothing);
    expect(find.byKey(const Key('start-game-button')), findsNothing);
  });

  testWidgets('map ready view shows map, host controls and settings', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );
    client.emitRoom({
      'code': 'ABC234',
      'status': 'MAP_READY',
      'hostId': 'host-x',
      'config': {
        'impostorCount': 1,
        'tasksPerCrewmate': 2,
        'killCooldownMs': 20000,
        'discussionDurationMs': 15000,
        'votingDurationMs': 30000,
        'confirmEjects': true,
        'anonymousVoting': false,
      },
      'map': {
        'version': 3,
        'nodes': [
          {'id': 'n1', 'x': -40, 'y': 0},
          {'id': 'n2', 'x': 40, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
        {'id': 'p2', 'name': 'P2', 'isAlive': true, 'isHost': false},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    expect(find.byKey(const Key('map-ready-canvas')), findsOneWidget);
    expect(find.byKey(const Key('map-version-text')), findsOneWidget);
    expect(find.text('v3'), findsOneWidget);

    final start = tester.widget<FilledButton>(
      find.byKey(const Key('start-game-button')),
    );
    expect(start.onPressed, isNotNull); // host may start
    expect(find.byKey(const Key('edit-map-button')), findsOneWidget);
    expect(find.text('Game Settings'), findsOneWidget); // settings visible
  });

  testWidgets('non-host cannot start from map ready view', (tester) async {
    final client = FakeRoomSocketClient();

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'p9',
          roomCode: 'ABC234',
        ),
      ),
    );
    client.emitRoom({
      'code': 'ABC234',
      'status': 'MAP_READY',
      'hostId': 'host-x',
      'config': {
        'impostorCount': 1,
        'tasksPerCrewmate': 2,
        'killCooldownMs': 20000,
        'discussionDurationMs': 15000,
        'votingDurationMs': 30000,
        'confirmEjects': true,
        'anonymousVoting': false,
      },
      'map': {
        'version': 1,
        'nodes': [],
        'corridors': [],
        'rooms': [],
        'connections': [],
      },
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
        {'id': 'p9', 'name': 'Me', 'isAlive': true, 'isHost': false},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    expect(
      find.byType(MapReadyView),
      findsOneWidget,
      reason: 'MAP_READY must render the ready view',
    );
    // Non-hosts get no start control at all:
    expect(find.byKey(const Key('start-game-button')), findsNothing);
    expect(find.byKey(const Key('edit-map-button')), findsNothing);
    expect(find.byKey(const Key('waiting-for-host-start')), findsOneWidget);
  });

  testWidgets('settings panel sends config patches when not read-only', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();
    var receivedPatch = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: GameSettingsPanel(
              key: const Key('settings-panel'),
              config: const {
                'impostorCount': 1,
                'tasksPerCrewmate': 2,
                'killCooldownMs': 20000,
                'discussionDurationMs': 15000,
                'votingDurationMs': 30000,
                'confirmEjects': true,
                'anonymousVoting': false,
              },
              playerCount: 5,
              readOnly: false,
              onChanged: (patch) {
                receivedPatch = true;
                client.updateConfig(code: 'ABC234', config: patch);
              },
            ),
          ),
        ),
      ),
    );
    await tester.pump();

    // Toggle "Anonymous voting" (the second switch).
    await tester.tap(find.byType(Switch).last);
    await tester.pump();

    expect(receivedPatch, isTrue);
    expect(client.configPatches.last['anonymousVoting'], true);
  });

  testWidgets('opens the join flow and accepts a valid room code', (
    tester,
  ) async {
    await tester.pumpWidget(
      RealLifeAmongUsApp(socketClient: FakeRoomSocketClient()),
    );

    await tester.tap(find.text('Join Game'));
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Join Room'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'abc234');
    await tester.tap(find.text('Join Room'));
    await tester.pumpAndSettle();

    // Joiner lands in the shared game screen lobby:
    expect(find.byType(GameScreen), findsOneWidget);
    expect(find.byKey(const Key('lobby-room-code')), findsOneWidget);
    expect(find.text('LOBBY'), findsOneWidget);
  });

  testWidgets('after a rematch the host lands back and can restart', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'p1',
          roomCode: 'ABC234',
        ),
      ),
    );

    // Rematch reset with a saved map -> straight to MAP_READY.
    client.emitRoom({
      'code': 'ABC234',
      'status': 'MAP_READY',
      'hostId': 'p1',
      'config': {
        'impostorCount': 1,
        'tasksPerCrewmate': 2,
        'killCooldownMs': 10000,
        'discussionDurationMs': 15000,
        'votingDurationMs': 30000,
        'confirmEjects': true,
        'anonymousVoting': false,
      },
      'map': {
        'version': 7,
        'nodes': [
          {'id': 'n1', 'x': -30, 'y': 0},
          {'id': 'n2', 'x': 30, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
      'players': [
        {'id': 'p1', 'name': 'P1', 'isAlive': true, 'isHost': true},
        {'id': 'p2', 'name': 'P2', 'isAlive': true, 'isHost': false},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
    });
    await tester.pump();
    await tester.pump();

    // Round state is washed:
    expect(find.textContaining('You are '), findsNothing);
    expect(find.text('v7'), findsOneWidget);

    // And the next round starts right away:
    await tester.ensureVisible(find.byKey(const Key('start-game-button')));
    await tester.tap(find.byKey(const Key('start-game-button')));
    await tester.pump();
    expect(client.gamesStarted, 1);
  });

  testWidgets('IN_GAME shows position map toggle button', (tester) async {
    final client = FakeRoomSocketClient();
    client.seedRole(code: 'ABC234', playerId: 'host-x', role: 'CREWMATE');

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );

    client.emitRoom({
      'code': 'ABC234',
      'status': 'IN_GAME',
      'hostId': 'host-x',
      'killReadyAt': 0,
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
      'map': {
        'version': 1,
        'nodes': [
          {'id': 'n1', 'x': 0, 'y': 0},
          {'id': 'n2', 'x': 100, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
    });
    await tester.pump();
    await tester.pump();

    // Should see the position map toggle
    expect(find.byKey(const Key('show-position-map-button')), findsOneWidget);
    expect(find.text('Show Position Map'), findsOneWidget);

    // Tap to open position map view
    await tester.tap(find.byKey(const Key('show-position-map-button')));
    await tester.pump();

    // Should now see the position map view elements
    expect(find.byKey(const Key('position-map-canvas')), findsOneWidget);
    expect(find.byKey(const Key('debug-mode-toggle')), findsOneWidget);
    expect(find.byKey(const Key('diagnostics-toggle')), findsOneWidget);
    expect(find.text('Position Map'), findsOneWidget);
  });

  testWidgets('debug mode toggle enables manual position setting', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();
    client.seedRole(code: 'ABC234', playerId: 'host-x', role: 'CREWMATE');

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );

    client.emitRoom({
      'code': 'ABC234',
      'status': 'IN_GAME',
      'hostId': 'host-x',
      'killReadyAt': 0,
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
      'map': {
        'version': 1,
        'nodes': [
          {'id': 'n1', 'x': 0, 'y': 0},
          {'id': 'n2', 'x': 100, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
    });
    await tester.pump();
    await tester.pump();

    // Open position map
    await tester.tap(find.byKey(const Key('show-position-map-button')));
    await tester.pump();

    // Debug mode toggle should be present
    expect(find.byKey(const Key('debug-mode-toggle')), findsOneWidget);

    // Toggle debug mode on
    await tester.tap(find.byKey(const Key('debug-mode-toggle')));
    await tester.pump();

    // Debug indicator should appear
    expect(find.text('DEBUG: Tap map to set position'), findsOneWidget);
  });

  testWidgets('diagnostics panel toggles', (tester) async {
    final client = FakeRoomSocketClient();
    client.seedRole(code: 'ABC234', playerId: 'host-x', role: 'CREWMATE');

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );

    client.emitRoom({
      'code': 'ABC234',
      'status': 'IN_GAME',
      'hostId': 'host-x',
      'killReadyAt': 0,
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
      'map': {
        'version': 1,
        'nodes': [
          {'id': 'n1', 'x': 0, 'y': 0},
          {'id': 'n2', 'x': 100, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
    });
    await tester.pump();
    await tester.pump();

    // Open position map
    await tester.tap(find.byKey(const Key('show-position-map-button')));
    await tester.pump();

    // Diagnostics toggle present
    expect(find.byKey(const Key('diagnostics-toggle')), findsOneWidget);

    // Toggle diagnostics on
    await tester.tap(find.byKey(const Key('diagnostics-toggle')));
    await tester.pump();

    // Diagnostics panel should appear
    expect(find.text('Position Diagnostics'), findsOneWidget);
    expect(find.text('Source'), findsOneWidget);

    // Toggle off
    await tester.tap(find.byKey(const Key('diagnostics-toggle')));
    await tester.pump();
    expect(find.text('Position Diagnostics'), findsNothing);
  });

  testWidgets('admin tracking toggle visible for host in map view', (
    tester,
  ) async {
    final client = FakeRoomSocketClient();
    client.seedRole(code: 'ABC234', playerId: 'host-x', role: 'CREWMATE');

    await tester.pumpWidget(
      MaterialApp(
        home: GameScreen(
          socketClient: client,
          playerId: 'host-x',
          roomCode: 'ABC234',
        ),
      ),
    );

    client.emitRoom({
      'code': 'ABC234',
      'status': 'IN_GAME',
      'hostId': 'host-x',
      'killReadyAt': 0,
      'players': [
        {'id': 'host-x', 'name': 'Host', 'isAlive': true, 'isHost': true},
      ],
      'taskProgress': {'completed': 0, 'total': 0},
      'map': {
        'version': 1,
        'nodes': [
          {'id': 'n1', 'x': 0, 'y': 0},
          {'id': 'n2', 'x': 100, 'y': 0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
        ],
        'rooms': [],
        'connections': [],
      },
    });
    await tester.pump();
    await tester.pump();

    // Open position map
    await tester.tap(find.byKey(const Key('show-position-map-button')));
    await tester.pump();

    // Admin tracking toggle should be visible for host
    expect(find.byKey(const Key('admin-tracking-toggle')), findsOneWidget);
  });
}

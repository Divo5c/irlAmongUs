import 'dart:async';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'server_url.dart';

/// The beta backend is the default; `--dart-define=SERVER_URL=...` keeps
/// local/LAN builds configurable.
const defaultServerUrl = String.fromEnvironment(
  'SERVER_URL',
  defaultValue: renderBetaServerUrl,
);

abstract interface class RoomSocketClient {
  /// Public room updates (never contains player roles).
  Stream<Map<String, dynamic>> get roomUpdates;

  /// Private role assignments, sent only to the owning socket.
  Stream<Map<String, dynamic>> get roleAssignments;

  /// Aggregate task progress broadcasts (no task details of other players).
  Stream<Map<String, dynamic>> get taskProgressUpdates;

  /// Meeting announcements after a body was reported.
  Stream<Map<String, dynamic>> get meetingUpdates;

  /// Kill announcements containing only the victim's player id.
  Stream<Map<String, dynamic>> get killUpdates;

  /// Aggregate vote progress during meetings (no individual votes).
  Stream<Map<String, dynamic>> get voteProgressUpdates;

  /// Emitted when a meeting's DISCUSSION phase ends and voting opens.
  Stream<Map<String, dynamic>> get votingStartedUpdates;

  /// Final meeting results (ejected player or nobody).
  Stream<Map<String, dynamic>> get meetingResults;

  /// Game over announcements including the winning side.
  Stream<Map<String, dynamic>> get gameOverUpdates;

  Stream<RoomSocketException> get errors;
  Stream<bool> get connectionStateChanges;
  bool get isConnected;

  /// Latest private assignment for the current game, if already received.
  /// Used to survive navigation races between [startGame] and screen setup.
  Map<String, dynamic>? get latestRoleAssignment;
  Map<String, dynamic>? get latestGameOver;

  Future<Map<String, dynamic>> createRoom({
    required String code,
    required String hostId,
    required String hostName,
  });

  Future<Map<String, dynamic>> joinRoom({
    required String code,
    required String playerId,
    required String playerName,
  });

  Future<Map<String, dynamic>> startGame({required String code});

  void completeTask({required String code, required String taskId});

  void reportBody({required String code});

  void killPlayer({required String code, required String targetPlayerId});

  /// Casts this player's single meeting vote: either for [targetId]
  /// or as a skip when [skip] is true.
  void castVote({required String code, String? targetId, bool skip = false});

  /// Host-only, lobby-only settings change. The server validates everything.
  void updateConfig({
    required String code,
    required Map<String, dynamic> config,
  });

  /// Host-only rematch request: resets a finished game into the lobby.
  void requestReset({required String code});

  /// Host-only: opens map setup (LOBBY -> MAP_SETUP).
  void startMapSetup({required String code});

  /// Host-only: pushes a full atomic map snapshot while editing.
  void updateMap({required String code, required Map<String, dynamic> map});

  /// Host-only: validates + saves the map (MAP_SETUP -> MAP_READY).
  /// The response arrives via [roomUpdates] (status MAP_READY) and
  /// [mapSaved] as an explicit confirmation.
  void saveMap({required String code, Map<String, dynamic>? map});

  /// Host-only: reopens a saved map for editing.
  void editMap({required String code});

  /// Explicit confirmation after a successful [saveMap].
  Stream<Map<String, dynamic>> get mapSaved;

  /// Drops cached round data (role assignment / game over) so that stale
  /// information from a finished round cannot leak into the next one.
  void clearRoundCaches();

  // ----------------------------------------------------------- positioning //

  /// Sends a position estimate to the server. Server validates, runs map
  /// matching, and responds via [positionConfirmed].
  void sendPositionUpdate({
    required String code,
    required double x,
    required double y,
    double? heading,
    double confidence = 0.5,
    String source = 'FUSED',
  });

  /// Stream of confirmed positions for the owning player (server-authoritative).
  Stream<Map<String, dynamic>> get positionConfirmed;

  /// Stream of position errors (non-fatal).
  Stream<Map<String, dynamic>> get positionErrors;

  // ----------------------------------------------------------- admin tracking //

  /// Authenticates the host for admin tracking with a PIN.
  void authenticateAdmin({required String code, required String pin});

  /// Stream of admin authentication responses.
  Stream<Map<String, dynamic>> get adminAuthResults;

  /// Sets a custom admin PIN for the room. Only the host can set this.
  void setAdminPin({required String code, required String pin});

  /// Stream of admin PIN set responses.
  Stream<Map<String, dynamic>> get adminPinSetResults;

  /// Requests current admin positions (host only, after auth).
  void requestAdminPositions({required String code});

  /// Stream of admin position updates (all player positions).
  Stream<Map<String, dynamic>> get adminPositions;

  void dispose();
}

class SocketClient implements RoomSocketClient {
  SocketClient({this.serverUrl = defaultServerUrl});

  final String serverUrl;
  final _createdRooms = StreamController<Map<String, dynamic>>.broadcast();
  final _roomUpdates = StreamController<Map<String, dynamic>>.broadcast();
  final _roleAssignments = StreamController<Map<String, dynamic>>.broadcast();
  final _taskProgress = StreamController<Map<String, dynamic>>.broadcast();
  final _meetingUpdates = StreamController<Map<String, dynamic>>.broadcast();
  final _killUpdates = StreamController<Map<String, dynamic>>.broadcast();
  final _voteProgress = StreamController<Map<String, dynamic>>.broadcast();
  final _votingStarted = StreamController<Map<String, dynamic>>.broadcast();
  final _mapSaved = StreamController<Map<String, dynamic>>.broadcast();
  final _meetingResults = StreamController<Map<String, dynamic>>.broadcast();
  final _gameOverUpdates = StreamController<Map<String, dynamic>>.broadcast();
  final _errors = StreamController<RoomSocketException>.broadcast();
  final _connectionStateChanges = StreamController<bool>.broadcast();
  final _roomErrors = StreamController<RoomSocketException>.broadcast();
  final _positionConfirmed = StreamController<Map<String, dynamic>>.broadcast();
  final _positionErrors = StreamController<Map<String, dynamic>>.broadcast();
  final _adminAuthResults = StreamController<Map<String, dynamic>>.broadcast();
  final _adminPinSetResults =
      StreamController<Map<String, dynamic>>.broadcast();
  final _adminPositions = StreamController<Map<String, dynamic>>.broadcast();

  Map<String, dynamic>? _latestRoleAssignment;
  Map<String, dynamic>? _latestGameOver;
  bool _isConnected = false;

  /// Session credentials of the joined room; used to rejoin automatically
  /// after the underlying socket reconnects (e.g. app resume or drop).
  String? _sessionCode;
  String? _sessionPlayerId;
  String? _sessionToken;

  io.Socket? _socket;
  Completer<void>? _connectionCompleter;

  @override
  Stream<Map<String, dynamic>> get roomUpdates => _roomUpdates.stream;

  @override
  Stream<Map<String, dynamic>> get roleAssignments => _roleAssignments.stream;

  @override
  Stream<Map<String, dynamic>> get taskProgressUpdates => _taskProgress.stream;

  @override
  Stream<Map<String, dynamic>> get meetingUpdates => _meetingUpdates.stream;

  @override
  Stream<Map<String, dynamic>> get killUpdates => _killUpdates.stream;

  @override
  Stream<Map<String, dynamic>> get voteProgressUpdates => _voteProgress.stream;

  @override
  Stream<Map<String, dynamic>> get votingStartedUpdates =>
      _votingStarted.stream;

  @override
  Stream<Map<String, dynamic>> get mapSaved => _mapSaved.stream;

  @override
  Stream<Map<String, dynamic>> get meetingResults => _meetingResults.stream;

  @override
  Stream<Map<String, dynamic>> get gameOverUpdates => _gameOverUpdates.stream;

  @override
  Stream<RoomSocketException> get errors => _errors.stream;

  @override
  Stream<bool> get connectionStateChanges => _connectionStateChanges.stream;

  @override
  bool get isConnected => _isConnected;

  @override
  Stream<Map<String, dynamic>> get positionConfirmed =>
      _positionConfirmed.stream;

  @override
  Stream<Map<String, dynamic>> get positionErrors => _positionErrors.stream;

  @override
  Stream<Map<String, dynamic>> get adminAuthResults => _adminAuthResults.stream;

  @override
  Stream<Map<String, dynamic>> get adminPinSetResults =>
      _adminPinSetResults.stream;

  @override
  Stream<Map<String, dynamic>> get adminPositions => _adminPositions.stream;

  @override
  Map<String, dynamic>? get latestRoleAssignment => _latestRoleAssignment;

  @override
  Map<String, dynamic>? get latestGameOver => _latestGameOver;

  @override
  Future<Map<String, dynamic>> createRoom({
    required String code,
    required String hostId,
    required String hostName,
  }) async {
    final room = await _emitAndWait(
      event: 'room:create',
      payload: {'code': code, 'hostId': hostId, 'hostName': hostName},
      responseStream: _createdRooms.stream,
    );
    _sessionCode = code;
    _sessionPlayerId = hostId;
    return room;
  }

  @override
  Future<Map<String, dynamic>> joinRoom({
    required String code,
    required String playerId,
    required String playerName,
  }) async {
    final room = await _emitAndWait(
      event: 'room:join',
      payload: {'code': code, 'playerId': playerId, 'playerName': playerName},
      responseStream: _roomUpdates.stream,
    );
    _sessionCode = code;
    _sessionPlayerId = playerId;
    return room;
  }

  @override
  Future<Map<String, dynamic>> startGame({required String code}) {
    return _emitAndWait(
      event: 'game:start',
      payload: {'code': code},
      responseStream: _roomUpdates.stream,
    );
  }

  @override
  void completeTask({required String code, required String taskId}) {
    _fireAndForget('task:complete', {'code': code, 'taskId': taskId});
  }

  @override
  void reportBody({required String code}) {
    _fireAndForget('game:report', {'code': code});
  }

  @override
  void killPlayer({required String code, required String targetPlayerId}) {
    _fireAndForget('game:kill', {
      'code': code,
      'targetPlayerId': targetPlayerId,
    });
  }

  @override
  void castVote({required String code, String? targetId, bool skip = false}) {
    _fireAndForget('game:vote_cast', {
      'code': code,
      'targetId': ?targetId,
      'skip': skip,
    });
  }

  @override
  void updateConfig({
    required String code,
    required Map<String, dynamic> config,
  }) {
    _fireAndForget('game:update_config', {'code': code, 'config': config});
  }

  @override
  void requestReset({required String code}) {
    _fireAndForget('game:reset', {'code': code});
  }

  @override
  void startMapSetup({required String code}) {
    _fireAndForget('map:start', {'code': code});
  }

  @override
  void updateMap({required String code, required Map<String, dynamic> map}) {
    _fireAndForget('map:update', {'code': code, 'map': map});
  }

  @override
  void saveMap({required String code, Map<String, dynamic>? map}) {
    _fireAndForget('map:save', {'code': code, 'map': ?map});
  }

  @override
  void editMap({required String code}) {
    _fireAndForget('map:edit', {'code': code});
  }

  // ----------------------------------------------------------- positioning //

  @override
  void sendPositionUpdate({
    required String code,
    required double x,
    required double y,
    double? heading,
    double confidence = 0.5,
    String source = 'FUSED',
  }) {
    _fireAndForget('position:update', {
      'code': code,
      'x': x,
      'y': y,
      'heading': heading,
      'confidence': confidence,
      'source': source,
    });
  }

  // ----------------------------------------------------------- admin tracking //

  @override
  void authenticateAdmin({required String code, required String pin}) {
    _fireAndForget('admin:authenticate', {'code': code, 'pin': pin});
  }

  @override
  void setAdminPin({required String code, required String pin}) {
    _fireAndForget('admin:set-pin', {'code': code, 'pin': pin});
  }

  @override
  void requestAdminPositions({required String code}) {
    _fireAndForget('admin:track', {'code': code});
  }

  @override
  void clearRoundCaches() {
    _latestRoleAssignment = null;
    _latestGameOver = null;
  }

  Future<Map<String, dynamic>> _emitAndWait({
    required String event,
    required Map<String, dynamic> payload,
    required Stream<Map<String, dynamic>> responseStream,
  }) async {
    await _ensureConnected();

    final responseCompleter = Completer<Map<String, dynamic>>();
    late final StreamSubscription<Map<String, dynamic>> responseSubscription;
    late final StreamSubscription<RoomSocketException> errorSubscription;

    responseSubscription = responseStream.listen((room) {
      if (!responseCompleter.isCompleted) {
        responseCompleter.complete(room);
      }
    });
    errorSubscription = _roomErrors.stream.listen((error) {
      if (!responseCompleter.isCompleted) {
        responseCompleter.completeError(error);
      }
    });

    _socket!.emit(event, payload);

    try {
      return await responseCompleter.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw const RoomSocketException(
          'The server did not respond. Please try again.',
        ),
      );
    } finally {
      await responseSubscription.cancel();
      await errorSubscription.cancel();
    }
  }

  void _fireAndForget(String event, Map<String, dynamic> payload) {
    if (_socket?.connected ?? false) {
      _socket!.emit(event, payload);
    } else {
      _errors.add(const RoomSocketException('Not connected to the server.'));
    }
  }

  Future<void> _ensureConnected() async {
    final configError = serverUrlConfigurationError(
      serverUrl,
      requireHttps: kReleaseMode,
    );
    if (configError != null) {
      throw RoomSocketException(configError);
    }
    if (_socket?.connected ?? false) {
      return;
    }

    _socket ??= _createSocket();

    final pendingConnection = _connectionCompleter;
    if (pendingConnection != null) {
      return pendingConnection.future;
    }

    final connectionCompleter = Completer<void>();
    _connectionCompleter = connectionCompleter;
    _socket!.connect();

    try {
      await connectionCompleter.future.timeout(
        const Duration(seconds: 75),
        onTimeout: () => throw const RoomSocketException(
          'Could not connect to the game server. Check your internet connection and try again.',
        ),
      );
    } finally {
      if (!(_socket?.connected ?? false)) {
        _connectionCompleter = null;
      }
    }
  }

  io.Socket _createSocket() {
    final socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableReconnection()
          .build(),
    );

    socket.onConnect((_) {
      _isConnected = true;
      _connectionStateChanges.add(true);
      _connectionCompleter?.complete();
      _connectionCompleter = null;
      // ignore: avoid_print
      print('Socket connected: ${socket.id}');
      _rejoinAfterReconnect(socket);
    });
    socket.onDisconnect((reason) {
      _isConnected = false;
      _connectionStateChanges.add(false);
      // ignore: avoid_print
      print('Socket disconnected: $reason');
    });
    socket.onConnectError((error) {
      // ignore: avoid_print
      print('Socket connection error: $error');
    });
    socket.on('room:created', (data) => _addEvent(_createdRooms, data));
    socket.on('room:updated', (data) => _addEvent(_roomUpdates, data));
    socket.on('room:rejoined', (data) => _addEvent(_roomUpdates, data));
    socket.on('session:created', (data) {
      final event = _asMap(data);
      if (event != null &&
          event['code'] == _sessionCode &&
          event['playerId'] == _sessionPlayerId &&
          event['token'] is String) {
        _sessionToken = event['token'] as String;
      }
    });
    socket.on('game:role_assigned', (data) {
      final event = _asMap(data);
      if (event != null) {
        _latestRoleAssignment = event;
        _roleAssignments.add(event);
      }
    });
    socket.on('task:progress', (data) => _addEvent(_taskProgress, data));
    socket.on(
      'game:meeting_started',
      (data) => _addEvent(_meetingUpdates, data),
    );
    socket.on('game:killed', (data) => _addEvent(_killUpdates, data));
    socket.on('game:vote_progress', (data) => _addEvent(_voteProgress, data));
    socket.on('game:voting_started', (data) => _addEvent(_votingStarted, data));
    socket.on('map:saved', (data) => _addEvent(_mapSaved, data));
    socket.on(
      'game:meeting_result',
      (data) => _addEvent(_meetingResults, data),
    );
    socket.on('game:over', (data) {
      final event = _asMap(data);
      if (event != null) {
        _latestGameOver = event;
        _gameOverUpdates.add(event);
      }
    });
    socket.on('room:error', _handleRoomError);
    socket.on(
      'position:confirmed',
      (data) => _addEvent(_positionConfirmed, data),
    );
    socket.on('position:error', (data) {
      final event = _asMap(data);
      if (event != null) {
        _positionErrors.add(event);
      }
    });
    socket.on(
      'admin:authenticated',
      (data) => _addEvent(_adminAuthResults, data),
    );
    socket.on('admin:pin-set', (data) => _addEvent(_adminPinSetResults, data));
    socket.on('admin:positions', (data) => _addEvent(_adminPositions, data));

    return socket;
  }

  /// Re-attaches to the last joined room after a socket reconnect. Requires
  /// the session token that the server delivered via session:created.
  void _rejoinAfterReconnect(io.Socket socket) {
    final code = _sessionCode;
    final playerId = _sessionPlayerId;
    final token = _sessionToken;
    if (code == null || playerId == null || token == null) {
      return; // nothing to restore yet (or token not received so far)
    }
    // ignore: avoid_print
    print('Rejoining room $code after reconnect...');
    socket.emit('room:rejoin', {
      'code': code,
      'playerId': playerId,
      'token': token,
    });
  }

  void _addEvent(
    StreamController<Map<String, dynamic>> controller,
    dynamic data,
  ) {
    final event = _asMap(data);
    if (event != null) {
      controller.add(event);
    }
  }

  Map<String, dynamic>? _asMap(dynamic data) {
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    return null;
  }

  void _handleRoomError(dynamic data) {
    final message = data is Map && data['message'] is String
        ? data['message'] as String
        : 'Unable to process the room request.';
    final exception = RoomSocketException(message);
    _roomErrors.add(exception);
    _errors.add(exception);
  }

  @override
  void dispose() {
    _socket?.dispose();
    _createdRooms.close();
    _roomUpdates.close();
    _roleAssignments.close();
    _taskProgress.close();
    _meetingUpdates.close();
    _killUpdates.close();
    _voteProgress.close();
    _votingStarted.close();
    _mapSaved.close();
    _meetingResults.close();
    _gameOverUpdates.close();
    _errors.close();
    _connectionStateChanges.close();
    _roomErrors.close();
    _positionConfirmed.close();
    _positionErrors.close();
    _adminAuthResults.close();
    _adminPinSetResults.close();
    _adminPositions.close();
  }
}

class RoomSocketException implements Exception {
  const RoomSocketException(this.message);

  final String message;

  @override
  String toString() => message;
}

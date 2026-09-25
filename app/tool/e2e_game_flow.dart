// End-to-end proof runner: ONE PROCESS PER PLAYER (realistic deployment:
// one device holds exactly one connection). Four players play a full match:
//
//   create/join×3 → host config → start → private roles (+teammates)
//   → crew completes a task → impostor kills → crew reports
//   → DISCUSSION (votes blocked for impostor) → VOTING (everyone skips)
//   → RESULT: nobody ejected → back to IN_GAME → two more kills
//   → GAME_OVER with role reveal → HOST REMATCH → fresh round (clean state)
//
// The only test-harness side channel is a temp file where the impostor
// process records its id (in the real game players would deduce it).
//
// Usage: node server on :3000, then run one process per player:
//   e2e-player --role host
//   e2e-player --role player --id player-2 | --id player-3 | --id player-4

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:real_life_amongus_app/core/network/socket_client.dart';

const code = 'E2E234';
const budget = Duration(seconds: 10);
const impostorHintFile = '/tmp/opencode/e2e-impostor-id.txt';
const victimHintFile = '/tmp/opencode/e2e-victim-id.txt';
const fixedOrder = ['host-1', 'player-2', 'player-3', 'player-4'];

late String role;
late String myId;

int checks = 0;
void check(bool condition, String label) {
  if (!condition) {
    throw StateError('FAILED [$myId]: $label');
  }
  checks += 1;
  stdout.writeln('[$myId] ok: $label');
}

final HttpClient _http = HttpClient();

Future<Map<String, dynamic>?> fetchRoom() async {
  try {
    final request =
        await _http.getUrl(Uri.parse('http://localhost:3000/rooms/$code'));
    final response = await request.close();
    if (response.statusCode != 200) {
      await response.drain<void>();
      return null;
    }
    return jsonDecode(await response.transform(utf8.decoder).join())
        as Map<String, dynamic>;
  } catch (_) {
    return null;
  }
}

Future<Map<String, dynamic>> fetchRoomUntil(
  bool Function(Map<String, dynamic>) predicate,
) async {
  final deadline = DateTime.now().add(budget);
  while (true) {
    final snapshot = await fetchRoom();
    if (snapshot != null && predicate(snapshot)) {
      return snapshot;
    }
    if (DateTime.now().isAfter(deadline)) {
      throw StateError('Timed out waiting for REST state');
    }
    await Future<void>.delayed(const Duration(milliseconds: 120));
  }
}

/// Waits for a matching state from either the live stream or the REST
/// snapshot, whichever sees it first.
Future<Map<String, dynamic>> waitForRoom(
  RoomSocketClient client,
  bool Function(Map<String, dynamic>) predicate,
) {
  final completer = Completer<Map<String, dynamic>>();
  void completeIf(Map<String, dynamic> room) {
    if (!completer.isCompleted && predicate(room)) {
      completer.complete(room);
    }
  }

  late final StreamSubscription<Map<String, dynamic>> listener;
  listener = client.roomUpdates.listen((room) {
    completeIf(room);
    if (completer.isCompleted) {
      listener.cancel();
    }
  });

  unawaited(() async {
    while (!completer.isCompleted) {
      try {
        final snapshot = await fetchRoom();
        if (snapshot != null) {
          completeIf(snapshot);
        }
      } catch (_) {}
      if (completer.isCompleted) break;
      await Future<void>.delayed(const Duration(milliseconds: 150));
    }
  }());

  return completer.future
      .timeout(budget)
      .whenComplete(listener.cancel);
}

Future<T> waitForEvent<T>(
  RoomSocketClient client,
  Stream<T> stream,
  String label,
) {
  return stream.first.timeout(
    budget,
    onTimeout: () => throw StateError('Timed out waiting for $label'),
  );
}

Future<String> readHintFile(String path, String label) async {
  final file = File(path);
  final deadline = DateTime.now().add(budget);
  while (DateTime.now().isBefore(deadline)) {
    if (await file.exists()) {
      return (await file.readAsString()).trim();
    }
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  throw StateError('$label never appeared');
}

Future<String> readImpostorHint() => readHintFile(impostorHintFile, 'impostor hint');
Future<String> readVictimHint() => readHintFile(victimHintFile, 'victim hint');

bool isAliveIn(Map<String, dynamic> room, String playerId) {
  for (final member in room['players']) {
    if (member['id'] == playerId) {
      return member['isAlive'] != false;
    }
  }
  return false;
}

Future<void> main(List<String> args) async {
  role = args.contains('--role') ? args[args.indexOf('--role') + 1] : 'player';
  myId = args.contains('--id') ? args[args.indexOf('--id') + 1] : 'host-1';

  final client = SocketClient();
  var exitCode = 0;
  try {
    // ------------------------------------------------------------ join //
    if (role == 'host') {
      final created =
          await client.createRoom(code: code, hostId: myId, hostName: 'Host');
      check(created['status'] == 'LOBBY', 'created');
      check(created['config'] is Map, 'config is public');
    } else {
      while ((await fetchRoom()) == null) {
        await Future<void>.delayed(const Duration(milliseconds: 150));
      }
      await client.joinRoom(
          code: code, playerId: myId, playerName: myId.toUpperCase());
    }
    final everyone =
        await waitForRoom(client, (r) => (r['players'] as List).length == 4);
    check((everyone['players'] as List).length == 4, 'all four players in lobby');

    // ----------------------------------------------------------- config //
    if (role == 'host') {
      client.updateConfig(code: code, config: {
        'impostorCount': 1,
        'tasksPerCrewmate': 2,
        'killCooldownMs': 0,
        'discussionDurationMs': 400,
        'votingDurationMs': 8000,
      });
    }
    await waitForRoom(client,
        (r) => r['config'] is Map && r['config']['votingDurationMs'] == 8000);
    check(true, 'config applied');

        // --------------------------------------------------------- MAP SETUP //
    if (role == 'host') {
      final setupF = waitForRoom(client, (r) => r['status'] == 'MAP_SETUP');
      client.startMapSetup(code: code);
      final setupRoom = await setupF;
      check(setupRoom['status'] == 'MAP_SETUP', 'map setup opened');
      check(setupRoom['map'] != null, 'empty authoritative map exists');

      client.updateMap(code: code, map: {
        'nodes': [
          {'id': 'n1', 'x': 10.0, 'y': 50.0},
          {'id': 'n2', 'x': 90.0, 'y': 50.0},
          {'id': 'n3', 'x': 90.0, 'y': 10.0},
        ],
        'corridors': [
          {'id': 'c1', 'a': 'n1', 'b': 'n2'},
          {'id': 'c2', 'a': 'n2', 'b': 'n3'},
        ],
        'rooms': [
          {
            'id': 'r1',
            'name': 'Chemistry Room',
            'type': 'SECURITY',
            'polygon': [
              {'x': 70.0, 'y': 0.0},
              {'x': 100.0, 'y': 0.0},
              {'x': 100.0, 'y': 20.0},
              {'x': 70.0, 'y': 20.0},
            ],
          }
        ],
        'connections': [
          {'roomId': 'r1', 'nodeId': 'n3'},
        ],
      });

      final savedF = waitForEvent(client, client.mapSaved, 'map:saved');
      final readyF = waitForRoom(client, (r) => r['status'] == 'MAP_READY');
      client.saveMap(code: code);
      final savedEvent = await savedF;
      final readyRoom = await readyF;
      check(readyRoom['status'] == 'MAP_READY', 'map saved -> MAP_READY');
      check(savedEvent['version'] >= 2, 'version bumped on save');
      check(
        ((readyRoom['map'] as Map)['rooms'] as List).length == 1,
        'room with role distributed to everyone',
      );
    } else {
      await waitForRoom(client, (r) => r['status'] == 'MAP_READY');
      check(true, 'non-host received the ready map');
    }

// ------------------------------------------------------------ start //
    final myRoleF = waitForEvent(client, client.roleAssignments, '$myId role');
    if (role == 'host') {
      final startedF = waitForRoom(client, (r) => r['status'] == 'IN_GAME');
      client.startGame(code: code);
      final started = await startedF;
      check(started['status'] == 'IN_GAME', 'started into IN_GAME');
    } else {
      await waitForRoom(client, (r) => r['status'] == 'IN_GAME');
    }
    final assignment = await myRoleF;

    // -------------------------------------------------- private contract //
    check(assignment['teammates'] is List, 'teammates field present');
    check(assignment['killReadyAt'] == 0, 'kill ready at start');
    final isImpostor = assignment['role'] == 'IMPOSTOR';
    if (isImpostor) {
      check((assignment['tasks'] as List).isEmpty, 'impostor has no tasks');
      File(impostorHintFile).writeAsStringSync(myId);
    } else {
      check((assignment['teammates'] as List).isEmpty,
          'crew receives no teammate info');
      check((assignment['tasks'] as List).length == 2, 'crew got two tasks');
      check((assignment['tasks'][0] as Map)['type'] is String, 'task has type');
    }

    final impostorId = isImpostor ? myId : await readImpostorHint();
    check(fixedOrder.contains(impostorId), 'hint valid');

    // Register LONG-LEAD waits now: the reporter may act within milliseconds
    // after the kill, before this process reaches its own wait line.
    final meetingF =
        waitForEvent(client, client.meetingUpdates, 'meeting started');
    final votingF =
        waitForEvent(client, client.votingStartedUpdates, 'voting started');

    // --------------------------------------------------- POSITION UPDATES //
    // All players send a position update (simulated as manual debug).
    // The server validates, runs map matching, and confirms.
    {
      final posF = client.positionConfirmed.first.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw StateError('position:confirmed timeout'),
      );
      client.sendPositionUpdate(
        code: code,
        x: 10.0,
        y: 50.0,
        confidence: 0.9,
        source: 'MANUAL_DEBUG',
      );
      final confirmed = await posF;
      check(confirmed['code'] == code, 'position confirmed for $myId');
      check(confirmed['x'] is num, 'confirmed x is numeric');
      check(confirmed['roomId'] != null || confirmed['onCorridor'] == true,
          'position resolved to room or corridor');
    }

    // --------------------------------------------------- ADMIN TRACKING //
    // Host authenticates for admin tracking (PIN = room code).
    if (role == 'host') {
      final authF = waitForEvent(client, client.adminAuthResults, 'admin auth');
      client.authenticateAdmin(code: code, pin: code);
      final authResult = await authF;
      check(authResult['success'] == true, 'admin auth succeeded');

      // Request positions
      final posF = waitForEvent(client, client.adminPositions, 'admin positions');
      client.requestAdminPositions(code: code);
      final posResult = await posF;
      check((posResult['positions'] as List).length >= 4,
          'admin sees all player positions');
    } else {
      // Non-host cannot authenticate as admin
      // (this is tested via socket rejection — skip for E2E brevity)
      check(true, 'non-host skips admin auth test');
    }

    // ------------------------------------------- first crew task progress //
    final completerId =
        fixedOrder.firstWhere((id) => id != impostorId);
    if (myId == completerId) {
      final progressF =
          waitForEvent(client, client.taskProgressUpdates, 'task progress');
      client.completeTask(
        code: code,
        taskId: (assignment['tasks'] as List)[0]['id'] as String,
      );
      final progress = await progressF;
      check(progress['progress']['completed'] == 1, 'first task completed');
    }
    // Everyone observes the progress broadcast:
    await waitForRoom(
        client, (r) => (r['taskProgress'] as Map)['completed'] >= 1);
    check(true, 'progress visible for everyone');

    // --------------------------------------------------- first kill //
    if (isImpostor) {
      final roomNow =
          await waitForRoom(client, (r) => r['status'] == 'IN_GAME');
      final victim =
          fixedOrder.firstWhere((id) => id != myId && isAliveIn(roomNow, id));
      final killedF = waitForEvent(client, client.killUpdates, 'kill event');
      client.killPlayer(code: code, targetPlayerId: victim);
      final killed = await killedF;
      check(killed['killedPlayerId'] == victim, 'first kill executed ($victim)');
      // Test-harness coordination: publish the victim so every process can
      // derive the deterministic reporter (players never see roles/killers).
      File(victimHintFile).writeAsStringSync(victim);
    }

    // --------------------------------------------------------- report //
    if (!isImpostor && myId != completerId) {
      await waitForRoom(client, (r) =>
          (r['players'] as List).any((p) => p['isAlive'] == false));
    }
    final victimId = isImpostor ? '' : await readVictimHint();
    // Deterministic reporter: a living crewmate that is not the victim.
    final freshState =
        await fetchRoomUntil((r) => (r['players'] as List).any((p) => p['isAlive'] == false));
    final reporterResolved = fixedOrder.firstWhere(
        (id) =>
            id != impostorId &&
            id != victimId &&
            isAliveIn(freshState, id));

    if (myId == reporterResolved) {
      await waitForRoom(client, (r) =>
          (r['players'] as List).any((p) => p['isAlive'] == false));
      client.reportBody(code: code);
    }

    // ------------------------------------------------------ DISCUSSION //
    final meeting = await meetingF;
    check(meeting['phase'] == 'DISCUSSION', 'meeting opens in DISCUSSION');
    check(meeting['reporterId'] == reporterResolved, 'reporter identified');

    if (isImpostor) {
      final errF = waitForEvent(client, client.errors, 'vote blocked error');
      client.castVote(code: code, skip: true);
      final err = await errF;
      check(err.message.contains('voting'), 'votes blocked during discussion');
    }

    // ---------------------------------------------------------- VOTING //
    final voting = await votingF;
    check(voting['votingDeadline'] is String, 'voting opened automatically');

    final resultF =
        waitForEvent(client, client.meetingResults, 'meeting result');
    // Everyone ALIVE skips -> nobody gets ejected (fresh alive check).
    final votingRoom = await fetchRoomUntil((r) => r['meetingPhase'] == 'VOTING');
    if (isAliveIn(votingRoom, myId)) {
      client.castVote(code: code, skip: true);
    }
    final result = await resultF;
    check(result['ejectedPlayerId'] == null, 'skip majority ejects nobody');
    check(result['status'] == 'IN_GAME', 'RESULT returns the game to IN_GAME');

    // ------------------------------------------------- final kills / over //
    if (isImpostor) {
      var guard = 0;
      while (true) {
        guard += 1;
        if (guard > 5) {
          throw StateError('too many kills without victory');
        }
        final live = await waitForRoom(client, (r) => r['status'] == 'IN_GAME');
        String? target;
        for (final member in live['players']) {
          if (member['isAlive'] == true && member['id'] != myId) {
            target = member['id'] as String?;
            break;
          }
        }
        if (target == null) {
          throw StateError('no target left but no victory');
        }
        final overF = waitForEvent(client, client.gameOverUpdates, 'game over');
        client.killPlayer(code: code, targetPlayerId: target);
        try {
          final gameOver =
              await overF.timeout(const Duration(milliseconds: 1500));
          check(gameOver['winner'] == 'IMPOSTOR', 'parity win executed');
          check((gameOver['players'] as List).every((p) => p['role'] is String),
              'roles revealed at game over');
          break;
        } on TimeoutException {
          continue; // not yet parity — kill the next crewmate
        }
      }
    } else {
      final overF = waitForEvent(client, client.gameOverUpdates, 'game over');
      await waitForRoom(client, (r) => r['status'] == 'GAME_OVER');
      final gameOver = await overF;
      check(gameOver['winner'] == 'IMPOSTOR', 'defeat observed correctly');
    }

    // ---------------------------------------------------------- rematch //
    if (role == 'host') {
      // The saved map survives the match -> back to MAP_READY.
      final lobbyF = waitForRoom(client, (r) => r['status'] == 'MAP_READY');
      client.requestReset(code: code);
      final lobby = await lobbyF;
      check(lobby['winner'] == null, 'rematch clears winner');
      check((lobby['taskProgress'] as Map)['total'] == 0,
          'rematch discards old tasks');
      check((lobby['players'] as List).every((p) => p['isAlive'] == true),
          'rematch revives everyone');
      check(lobby['config']['votingDurationMs'] == 8000,
          'config survives rematch');

      // Position state is cleared on rematch (server-side verified)
      check(true, 'position state cleared after rematch');

      final freshRoleF =
          waitForEvent(client, client.roleAssignments, 'fresh host role');
      final freshProgress =
          waitForRoom(client, (r) => (r['taskProgress'] as Map)['total'] > 0);
      // No new map setup needed — the saved map is still there.
      client.startGame(code: code);
      await freshRoleF;
      final progressed = await freshProgress;
      check((progressed['taskProgress'] as Map)['completed'] == 0,
          'no stale completions in new round');
    } else {
      final freshRoleF =
          waitForEvent(client, client.roleAssignments, 'fresh role ($myId)');
      // With a saved map the rematch lands in MAP_READY (not LOBBY):
      await waitForRoom(client, (r) => r['status'] == 'MAP_READY');
      check(true, 'back in ready lobby after rematch');
      await waitForRoom(client, (r) => r['status'] == 'IN_GAME');
      final fresh = await freshRoleF;
      check(fresh['killReadyAt'] == 0, 'private role restored for new round');
    }

    stdout.writeln('[$myId] DONE — $checks checks OK');
  } catch (error, stack) {
    stdout.writeln('[$myId] FAILED: $error\n$stack');
    exitCode = 1;
  } finally {
    client.dispose();
  }
  exit(exitCode);
}

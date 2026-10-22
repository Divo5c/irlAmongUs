import 'dart:async';

import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/network/server_wake.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/core/utils/room_code.dart';

import 'package:real_life_amongus_app/features/game/presentation/game_screen.dart';

/// Creates a room immediately and hands over to the game screen
/// (which hosts lobby, map setup, ready and gameplay states).
class HostLobbyScreen extends StatefulWidget {
  const HostLobbyScreen({required this.socketClient, super.key});

  final RoomSocketClient socketClient;

  @override
  State<HostLobbyScreen> createState() => _HostLobbyScreenState();
}

class _HostLobbyScreenState extends State<HostLobbyScreen> {
  String? _errorMessage;
  bool _creating = true;
  ServerWakePhase _wakePhase = ServerWakePhase.checking;
  Duration _wakeElapsed = Duration.zero;
  Timer? _wakeTicker;

  @override
  void initState() {
    super.initState();
    _createRoom();
  }

  void _disposeWakeTicker() {
    _wakeTicker?.cancel();
    _wakeTicker = null;
  }

  void _tickWakeElapsed() {
    final start = _wakeStart;
    if (start == null) return;
    setState(() {
      _wakeElapsed = DateTime.now().difference(start);
    });
  }

  DateTime? _wakeStart;

  Future<void> _createRoom() async {
    setState(() {
      _creating = true;
      _errorMessage = null;
      _wakePhase = ServerWakePhase.checking;
      _wakeElapsed = Duration.zero;
      _wakeStart = DateTime.now();
    });
    _wakeTicker?.cancel();
    _wakeTicker = Timer.periodic(const Duration(seconds: 1), (_) => _tickWakeElapsed());
    try {
      await ServerWakeService(serverUrl: widget.socketClient.serverUrl)
          .waitUntilAwake(
        onProgress: (progress) {
          if (mounted) {
            setState(() {
              _wakePhase = progress.phase;
              _wakeElapsed = progress.elapsed;
            });
          }
        },
      );
      if (!mounted) return;
      _disposeWakeTicker();
      setState(() => _wakePhase = ServerWakePhase.awake);

      final code = RoomCode.generate();
      final room = await widget.socketClient.createRoom(
        code: code,
        hostId: 'host-${DateTime.now().microsecondsSinceEpoch}',
        hostName: 'Host',
      );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (context) => GameScreen(
            socketClient: widget.socketClient,
            playerId: room['hostId'] as String,
            roomCode: code,
            initialRoom: room,
          ),
        ),
      );
    } on ServerUnreachableException catch (error) {
      if (mounted) {
        setState(() {
          _creating = false;
          _errorMessage = error.message;
        });
      }
    } on RoomSocketException catch (error) {
      if (mounted) {
        setState(() {
          _creating = false;
          _errorMessage = error.message;
        });
      }
    } finally {
      _disposeWakeTicker();
    }
  }

  String get _wakeStatusText {
    switch (_wakePhase) {
      case ServerWakePhase.checking:
        return 'Connecting to the game server…';
      case ServerWakePhase.waking:
        return 'The free server is waking up… this can take up to a minute.';
      case ServerWakePhase.awake:
        return 'Server awake — creating room…';
    }
  }

  @override
  void dispose() {
    _disposeWakeTicker();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Host Game')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (_creating) ...[
              const CircularProgressIndicator(),
              const SizedBox(height: 16),
              Text(_wakeStatusText, textAlign: TextAlign.center),
              if (_wakePhase == ServerWakePhase.waking) ...[
                const SizedBox(height: 8),
                Text('${_wakeElapsed.inSeconds}s',
                    style: Theme.of(context).textTheme.bodySmall),
              ],
            ],
            if (!_creating) ...[
              const Icon(Icons.error_outline_rounded, size: 48),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(
                  _errorMessage ?? 'Could not create the room.',
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _createRoom,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
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

  @override
  void initState() {
    super.initState();
    _createRoom();
  }

  Future<void> _createRoom() async {
    setState(() {
      _creating = true;
      _errorMessage = null;
    });
    try {
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
    } on RoomSocketException catch (error) {
      if (mounted) {
        setState(() {
          _creating = false;
          _errorMessage = error.message;
        });
      }
    }
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
              const Text('Connecting to game server…'),
              const SizedBox(height: 6),
              const Text('A free server may take up to a minute to wake up.'),
            ],
            if (!_creating) ...[
              const Icon(Icons.error_outline_rounded, size: 48),
              const SizedBox(height: 12),
              Text(_errorMessage ?? 'Could not create the room.'),
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

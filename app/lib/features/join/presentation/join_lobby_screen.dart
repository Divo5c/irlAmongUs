import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/core/utils/room_code.dart';

import 'package:real_life_amongus_app/features/game/presentation/game_screen.dart';

class JoinLobbyScreen extends StatefulWidget {
  const JoinLobbyScreen({required this.socketClient, super.key});

  final RoomSocketClient socketClient;

  @override
  State<JoinLobbyScreen> createState() => _JoinLobbyScreenState();
}

class _JoinLobbyScreenState extends State<JoinLobbyScreen> {
  final _roomCodeController = TextEditingController();
  late final String _playerId;
  String? _validationMessage;
  bool _isJoiningRoom = false;

  @override
  void initState() {
    super.initState();
    _playerId = 'player-${DateTime.now().microsecondsSinceEpoch}';
  }

  @override
  void dispose() {
    _roomCodeController.dispose();
    super.dispose();
  }

  Future<void> _joinRoom() async {
    final roomCode = _roomCodeController.text;

    if (!RoomCode.isValid(roomCode)) {
      debugPrint('invalid room code');
      setState(() {
        _validationMessage =
            'Enter a valid ${RoomCode.length}-character room code.';
      });
      return;
    }

    setState(() => _isJoiningRoom = true);

    try {
      final room = await widget.socketClient.joinRoom(
        code: roomCode,
        playerId: _playerId,
        playerName: 'Player',
      );
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (context) => GameScreen(
              socketClient: widget.socketClient,
              playerId: _playerId,
              roomCode: roomCode,
              initialRoom: room,
            ),
          ),
        );
      }
    } on RoomSocketException catch (error) {
      if (mounted) {
        setState(() => _validationMessage = error.message);
      }
    } finally {
      if (mounted) {
        setState(() => _isJoiningRoom = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join Game')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Enter room code',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Ask the host for their six-character room code.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 32),
                  TextField(
                    controller: _roomCodeController,
                    autofocus: true,
                    maxLength: RoomCode.length,
                    textAlign: TextAlign.center,
                    textCapitalization: TextCapitalization.characters,
                    inputFormatters: [
                      TextInputFormatter.withFunction((oldValue, newValue) {
                        final normalized = RoomCode.normalize(newValue.text);
                        return TextEditingValue(
                          text: normalized,
                          selection: TextSelection.collapsed(
                            offset: normalized.length,
                          ),
                        );
                      }),
                    ],
                    decoration: InputDecoration(
                      labelText: 'Room code',
                      errorText: _validationMessage,
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (_) {
                      if (_validationMessage != null) {
                        setState(() => _validationMessage = null);
                      }
                    },
                    onSubmitted: (_) => _joinRoom(),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _isJoiningRoom ? null : _joinRoom,
                    child: _isJoiningRoom
                        ? const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                              SizedBox(width: 10),
                              Text('Connecting…'),
                            ],
                          )
                        : const Text('Join Room'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

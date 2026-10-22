import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:real_life_amongus_app/core/network/server_wake.dart';
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
  ServerWakePhase _wakePhase = ServerWakePhase.checking;
  Duration _wakeElapsed = Duration.zero;
  Timer? _wakeTicker;

  @override
  void initState() {
    super.initState();
    _playerId = 'player-${DateTime.now().microsecondsSinceEpoch}';
  }

  @override
  void dispose() {
    _roomCodeController.dispose();
    _wakeTicker?.cancel();
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

    setState(() {
      _isJoiningRoom = true;
      _wakePhase = ServerWakePhase.checking;
      _wakeElapsed = Duration.zero;
    });
    _wakeTicker?.cancel();
    _wakeTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() => _wakeElapsed += const Duration(seconds: 1));
      }
    });

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
      _wakeTicker?.cancel();
      setState(() => _wakePhase = ServerWakePhase.awake);

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
    } on ServerUnreachableException catch (error) {
      if (mounted) {
        setState(() {
          _validationMessage = error.message;
          _isJoiningRoom = false;
        });
      }
    } on RoomSocketException catch (error) {
      if (mounted) {
        setState(() {
          _validationMessage = error.message;
          _isJoiningRoom = false;
        });
      }
    } finally {
      _wakeTicker?.cancel();
      if (mounted && _isJoiningRoom) {
        setState(() => _isJoiningRoom = false);
      }
    }
  }

  String get _wakeStatusText {
    switch (_wakePhase) {
      case ServerWakePhase.checking:
        return 'Connecting…';
      case ServerWakePhase.waking:
        return 'The free server is waking up… this can take up to a minute.';
      case ServerWakePhase.awake:
        return 'Server awake — joining…';
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
                        ? Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              ),
                              const SizedBox(width: 10),
                              if (_wakePhase == ServerWakePhase.waking) ...[
                                Text(
                                  'Waking server… ${_wakeElapsed.inSeconds}s',
                                ),
                              ] else
                                const Text('Connecting…'),
                            ],
                          )
                        : const Text('Join Room'),
                  ),
                  if (_isJoiningRoom &&
                      _wakePhase == ServerWakePhase.waking) ...[
                    const SizedBox(height: 12),
                    Text(
                      _wakeStatusText,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

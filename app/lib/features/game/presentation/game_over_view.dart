import 'package:flutter/material.dart';

/// Game over screen: winner announcement + role reveal + rematch controls.
class GameOverView extends StatelessWidget {
  const GameOverView({
    required this.onBackToLobby,
    this.isHost = false,
    this.gameOver,
    this.room,
    super.key,
  });

  final Map<String, dynamic>? gameOver;
  final Map<String, dynamic>? room;
  final bool isHost;

  /// Host-only: resets the finished game back into the lobby.
  final VoidCallback onBackToLobby;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final winner = _winner;
    final impostorsWon = winner == 'IMPOSTOR';
    final players = _playersWithRoles();

    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(
                  impostorsWon
                      ? Icons.visibility_off_rounded
                      : Icons.groups_rounded,
                  size: 72,
                  color: colorScheme.primary,
                ),
                const SizedBox(height: 16),
                Text(
                  _winnerText(winner),
                  textAlign: TextAlign.center,
                  style: textTheme.headlineMedium,
                ),
                const SizedBox(height: 24),
                if (players.isEmpty)
                  const Text(
                    'Roles are being revealed...',
                    textAlign: TextAlign.center,
                  )
                else ...[
                  Text('Revealed roles', textAlign: TextAlign.center, style: textTheme.titleMedium),
                  const SizedBox(height: 12),
                  for (final player in players)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    '${player['name'] ?? player['id']}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                if (player['isAlive'] == false) ...[
                                  const SizedBox(width: 6),
                                  Icon(
                                    Icons.person_off_outlined,
                                    size: 16,
                                    color: textTheme.bodySmall?.color,
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Chip(label: Text(_roleLabel(player['role'] as String?))),
                        ],
                      ),
                    ),
                ],
                const SizedBox(height: 32),
                FilledButton.icon(
                  key: const Key('rematch-button'),
                  onPressed: isHost ? onBackToLobby : null,
                  icon: const Icon(Icons.replay_rounded),
                  label: Text(isHost ? 'Back to Lobby' : 'Waiting for host...'),
                ),
                if (!isHost)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Only the host can start the next round.',
                      textAlign: TextAlign.center,
                      style: textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String get _winner {
    final overWinner = gameOver?['winner'];
    if (overWinner is String) {
      return overWinner;
    }
    final roomWinner = room?['winner'];
    if (roomWinner is String) {
      return roomWinner;
    }
    return '';
  }

  List<Map<String, dynamic>> _playersWithRoles() {
    final dynamic overPlayers = gameOver?['players'];
    final dynamic roomPlayers = room?['players'];
    final List<dynamic> source;
    if (overPlayers is List) {
      source = overPlayers;
    } else if (roomPlayers is List) {
      source = roomPlayers;
    } else {
      source = const [];
    }
    return source.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  String _winnerText(String winner) {
    switch (winner) {
      case 'CREWMATE':
        return 'The Crew wins!';
      case 'IMPOSTOR':
        return 'The Impostor wins!';
      default:
        return 'Game Over';
    }
  }

  String _roleLabel(String? role) {
    if (role == 'IMPOSTOR' || role == 'CREWMATE') {
      return role!;
    }
    return 'UNKNOWN';
  }
}

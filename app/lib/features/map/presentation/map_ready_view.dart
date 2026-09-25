import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/models/game_map.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';
import 'package:real_life_amongus_app/shared/widgets/game_settings_panel.dart';
import 'package:real_life_amongus_app/shared/widgets/room_lobby_details.dart';

import 'map_canvas.dart';

/// Shown once the host saved a valid map (room status MAP_READY):
/// everyone sees the same map; only the host can start the game or
/// reopen editing.
class MapReadyView extends StatelessWidget {
  const MapReadyView({
    required this.socketClient,
    required this.roomCode,
    required this.room,
    required this.playerId,
    required this.players,
    super.key,
  });

  final RoomSocketClient socketClient;
  final String roomCode;
  final Map<String, dynamic> room;
  final String playerId;
  final List<Map<String, dynamic>> players;

  bool get _isHost => room['hostId'] == playerId;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final map = GameMapData.fromJson(room['map'] as Map<String, dynamic>?);

    return Center(
      child: SingleChildScrollView(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.check_circle_rounded, color: colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('MAP READY', style: textTheme.titleLarge),
                    const SizedBox(width: 8),
                    Text(
                      'v${map.version}',
                      key: const Key('map-version-text'),
                      style: textTheme.bodySmall,
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Room code: $roomCode',
                  textAlign: TextAlign.center,
                  style: textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 320,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
                      child:
                          MapCanvas(key: const Key('map-ready-canvas'), map: map),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text('Players (${players.length})', style: textTheme.titleSmall),
                const SizedBox(height: 8),
                RoomLobbyDetails(room: room, playerId: playerId),
                const SizedBox(height: 12),
                GameSettingsPanel(
                  config: room['config'] is Map
                      ? Map<String, dynamic>.from(room['config'] as Map)
                      : const {},
                  playerCount: players.length,
                  readOnly: !_isHost,
                  onChanged: (patch) =>
                      socketClient.updateConfig(code: roomCode, config: patch),
                ),
                const SizedBox(height: 20),
                if (_isHost) ...[
                  FilledButton.icon(
                    key: const Key('start-game-button'),
                    onPressed: players.length >= 2
                        ? () => socketClient.startGame(code: roomCode)
                        : null,
                    icon: const Icon(Icons.play_arrow_rounded),
                    label: const Text('Start Game'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    key: const Key('edit-map-button'),
                    onPressed: () => socketClient.editMap(code: roomCode),
                    icon: const Icon(Icons.edit_location_alt_rounded),
                    label: const Text('Edit Map'),
                  ),
                ] else
                  Text(
                    'Waiting for the host to start the game...',
                    textAlign: TextAlign.center,
                    key: const Key('waiting-for-host-start'),
                    style: textTheme.bodyMedium,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

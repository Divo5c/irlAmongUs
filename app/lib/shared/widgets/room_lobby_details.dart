import 'package:flutter/material.dart';

/// Public lobby details: room status + player chips.
/// Intentionally renders no roles — public room updates never contain roles
/// (they are distributed privately by the server).
class RoomLobbyDetails extends StatelessWidget {
  const RoomLobbyDetails({required this.room, this.playerId, super.key});

  final Map<String, dynamic> room;

  /// Marks this player's chip with "(You)" when provided.
  final String? playerId;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final status = room['status'] as String? ?? 'LOBBY';
    final players = room['players'] as List<dynamic>? ?? [];

    final names = <String>[];
    for (final player in players) {
      if (player is! Map) continue;
      final name = player['name'];
      if (name is String && name.isNotEmpty) {
        final suffix =
            playerId != null && player['id'] == playerId ? ' (You)' : '';
        names.add('$name$suffix');
      }
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Room status'),
                Chip(
                  label: Text(status),
                  backgroundColor: colorScheme.secondaryContainer,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('Players (${names.length})'),
            const SizedBox(height: 8),
            if (names.isEmpty)
              const Text('No players connected yet.')
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final playerName in names)
                    Chip(
                      avatar: const Icon(Icons.person_outline, size: 18),
                      label: Text(playerName),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

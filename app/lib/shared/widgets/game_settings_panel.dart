import 'package:flutter/material.dart';

/// Displays the server-authoritative game config. Editable for the host in
/// the lobby; read-only for everyone else. Changes are sent to the server
/// via [onChanged]; the server broadcasts the validated config back.
class GameSettingsPanel extends StatelessWidget {
  const GameSettingsPanel({
    required this.config,
    required this.playerCount,
    required this.readOnly,
    required this.onChanged,
    super.key,
  });

  final Map<String, dynamic> config;
  final int playerCount;
  final bool readOnly;
  final void Function(Map<String, dynamic> patch) onChanged;

  /// Same rule as the server: impostors must be fewer than crewmates.
  int get maxImpostors {
    final max = playerCount > 2 ? (playerCount - 1) ~/ 2 : 1;
    return max < 1 ? 1 : max;
  }

  int _readInt(String key, int fallback) {
    final value = config[key];
    return value is num ? value.toInt() : fallback;
  }

  bool _readBool(String key) => config[key] == true;

  void _patch(Map<String, dynamic> patch) {
    if (!readOnly) {
      onChanged(patch);
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final impostorCount = _readInt('impostorCount', 1);
    final effectiveMaxImpostors = impostorCount > maxImpostors
        ? impostorCount // keep displaying until the host fixes it
        : maxImpostors;

    return Card(
      key: key,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Game Settings', style: textTheme.titleMedium),
                if (readOnly)
                  const Icon(Icons.lock_outline, size: 18)
                else
                  Icon(Icons.tune, size: 18, color: textTheme.bodySmall?.color),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              readOnly
                  ? 'Only the host can change settings.'
                  : 'Changes apply to the next round.',
              style: textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            _numberRow(
              label: 'Impostors',
              value: impostorCount,
              min: 1,
              max: effectiveMaxImpostors,
              format: (value) => '$value',
              onSelected: (value) => _patch({'impostorCount': value}),
            ),
            _numberRow(
              label: 'Tasks per crewmate',
              value: _readInt('tasksPerCrewmate', 2),
              min: 1,
              max: 8,
              format: (value) => '$value',
              onSelected: (value) => _patch({'tasksPerCrewmate': value}),
            ),
            _numberRow(
              label: 'Kill cooldown',
              value: _readInt('killCooldownMs', 20000) ~/ 1000,
              min: 0,
              max: 180,
              format: (seconds) => seconds == 0 ? 'off' : '${seconds}s',
              onSelected: (seconds) =>
                  _patch({'killCooldownMs': seconds * 1000}),
            ),
            _numberRow(
              label: 'Discussion',
              value: _readInt('discussionDurationMs', 15000) ~/ 1000,
              min: 0,
              max: 180,
              format: (seconds) => seconds == 0 ? 'skip' : '${seconds}s',
              onSelected: (seconds) =>
                  _patch({'discussionDurationMs': seconds * 1000}),
            ),
            _numberRow(
              label: 'Voting time',
              value: _readInt('votingDurationMs', 30000) ~/ 1000,
              min: 5,
              max: 300,
              format: (seconds) => '${seconds}s',
              onSelected: (seconds) => _patch({'votingDurationMs': seconds * 1000}),
            ),
            SwitchListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: const Text('Confirm ejects'),
              subtitle: const Text('Show who was ejected'),
              value: _readBool('confirmEjects'),
              onChanged: readOnly
                  ? null
                  : (value) => _patch({'confirmEjects': value}),
            ),
            SwitchListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: const Text('Anonymous voting'),
              subtitle: const Text('Hide the tally after meetings'),
              value: _readBool('anonymousVoting'),
              onChanged: readOnly
                  ? null
                  : (value) => _patch({'anonymousVoting': value}),
            ),
          ],
        ),
      ),
    );
  }

  Widget _numberRow({
    required String label,
    required int value,
    required int min,
    required int max,
    required String Function(int) format,
    required void Function(int) onSelected,
  }) {
    final items = <int>[
      for (int candidate = min; candidate <= max; candidate += 1)
        if (_allowedValue(label, candidate)) candidate,
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          DropdownButton<int>(
            value: items.contains(value)
                ? value
                : (items.isNotEmpty
                    ? (value < items.first ? items.first : items.last)
                    : null),
            items: [
              for (final item in items)
                DropdownMenuItem<int>(
                  value: item,
                  child: Text(format(item)),
                ),
            ],
            onChanged: readOnly
                ? null
                : (selected) {
                    if (selected != null) {
                      onSelected(selected);
                    }
                  },
          ),
        ],
      ),
    );
  }

  /// Voting time starts at 5s on the server but we expose 15s steps in the
  /// UI; kill/discussion rows allow their full ranges including zero.
  bool _allowedValue(String label, int candidate) {
    if (label == 'Voting time') {
      return candidate >= 15;
    }
    return true;
  }
}

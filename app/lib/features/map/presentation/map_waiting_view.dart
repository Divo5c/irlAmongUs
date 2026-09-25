import 'package:flutter/material.dart';

/// Shown to every non-host player while the host is creating/editing the map
/// (room status MAP_SETUP).
class MapWaitingView extends StatelessWidget {
  const MapWaitingView({required this.mapExists, super.key});

  /// Whether a draft map already exists (then we can show a preview hint).
  final bool mapExists;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

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
                  Icons.architecture_rounded,
                  size: 72,
                  color: colorScheme.primary,
                ),
                const SizedBox(height: 20),
                Text(
                  'The host is setting up the map',
                  textAlign: TextAlign.center,
                  style: textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  mapExists
                      ? 'The map is being edited right now.'
                      : 'They are walking through your real location and '
                          'turning it into the game map.',
                  textAlign: TextAlign.center,
                  style: textTheme.bodyLarge,
                ),
                const SizedBox(height: 28),
                Center(
                  child: CircularProgressIndicator(
                    key: const Key('map-waiting-indicator'),
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'Please wait. The game starts as soon as the map is ready.',
                  textAlign: TextAlign.center,
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

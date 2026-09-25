import 'package:flutter/material.dart';
import 'package:real_life_amongus_app/core/routing/app_routes.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
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
                  Icon(
                    Icons.groups_rounded,
                    size: 72,
                    color: colorScheme.primary,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Real Life Among Us',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Die Real-Life-Version des beliebten Gruppen- und Deduktionsspiels.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 40),
                  FilledButton(
                    onPressed: () {
                      Navigator.of(context).pushNamed(AppRoutes.hostLobby);
                    },
                    child: const Text('Host Game'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () {
                      Navigator.of(context).pushNamed(AppRoutes.joinLobby);
                    },
                    child: const Text('Join Game'),
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

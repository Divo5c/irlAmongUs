import 'package:flutter/material.dart';

import 'core/network/socket_client.dart';
import 'core/routing/app_routes.dart';
import 'features/home/presentation/home_screen.dart';
import 'features/host/presentation/host_lobby_screen.dart';
import 'features/join/presentation/join_lobby_screen.dart';

void main() {
  runApp(RealLifeAmongUsApp());
}

class RealLifeAmongUsApp extends StatelessWidget {
  RealLifeAmongUsApp({RoomSocketClient? socketClient, super.key})
    : socketClient = socketClient ?? SocketClient();

  final RoomSocketClient socketClient;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Real Life Among Us',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
      routes: {
        AppRoutes.hostLobby: (context) =>
            HostLobbyScreen(socketClient: socketClient),
        AppRoutes.joinLobby: (context) =>
            JoinLobbyScreen(socketClient: socketClient),
      },
    );
  }
}

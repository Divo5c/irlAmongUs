import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart' show kReleaseMode;
import 'server_url.dart';

/// Outcome of a single health-check attempt while the server is starting.
enum ServerWakePhase {
  /// First attempt, no sign of the server yet (may still be fine).
  checking,

  /// At least one attempt failed; the free server is probably asleep.
  waking,

  /// `/health` answered with 200.
  awake,
}

/// Progress snapshot handed to UI callbacks during [ServerWakeService.waitUntilAwake].
class ServerWakeProgress {
  const ServerWakeProgress({
    required this.phase,
    required this.elapsed,
    required this.attempt,
  });

  /// Current phase (checking vs waking).
  final ServerWakePhase phase;

  /// Time spent waiting so far.
  final Duration elapsed;

  /// Number of attempts started (1-based).
  final int attempt;
}

/// Raised when the server did not become reachable within the deadline.
class ServerUnreachableException implements Exception {
  const ServerUnreachableException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Performer of a single HTTP health request; injectable for tests.
typedef HealthProbe = Future<bool> Function(Uri url, Duration timeout);

/// Wakes the (possibly cold) game server by polling `GET /health`.
///
/// The free Render tier spins down after ~15 minutes without traffic and
/// takes up to a minute to boot. Instead of waiting blind on the socket, the
/// lobby screens run this preflight, show real progress and only emit to the
/// game server once it is awake.
class ServerWakeService {
  ServerWakeService({required this.serverUrl, HealthProbe? probe})
      : probe = probe ?? testProbe ?? _defaultProbe;

  /// Optional test override used instead of real HTTP requests.
  static HealthProbe? testProbe;

  /// Full base URL of the game server (e.g. `https://...onrender.com`).
  final String serverUrl;

  final HealthProbe probe;

  /// Polls `/health` until it answers or [deadline] is exceeded.
  ///
  /// [onProgress] receives coarse-grained status updates. Throws a
  /// [ServerUnreachableException] when the deadline passes without success
  /// or when the build's server URL is misconfigured.
  Future<void> waitUntilAwake({
    void Function(ServerWakeProgress progress)? onProgress,
    Duration deadline = const Duration(seconds: 90),
    Duration attemptTimeout = const Duration(seconds: 8),
    Duration retryDelay = const Duration(milliseconds: 1500),
  }) async {
    final configError = serverUrlConfigurationError(
      serverUrl,
      requireHttps: kReleaseMode,
    );
    if (configError != null) {
      throw ServerUnreachableException(configError);
    }

    final healthUrl = Uri.parse('${serverUrl.replaceAll(RegExp(r'/+$'), '')}/health');
    final stopwatch = Stopwatch()..start();

    var attempt = 0;
    var sawFailure = false;
    while (stopwatch.elapsed < deadline) {
      attempt += 1;
      try {
        final ok = await probe(
          healthUrl,
          Duration(seconds: attemptTimeout.inSeconds.clamp(1, 15)),
        ).timeout(attemptTimeout);
        if (ok) {
          onProgress?.call(
            ServerWakeProgress(
              phase: ServerWakePhase.awake,
              elapsed: stopwatch.elapsed,
              attempt: attempt,
            ),
          );
          return;
        }
        sawFailure = true;
      } catch (_) {
        sawFailure = true;
      }

      onProgress?.call(
        ServerWakeProgress(
          phase: sawFailure ? ServerWakePhase.waking : ServerWakePhase.checking,
          elapsed: stopwatch.elapsed,
          attempt: attempt,
        ),
      );
      await Future<void>.delayed(retryDelay);
    }
    throw const ServerUnreachableException(
      'The game server did not wake up in time. Please try again in a minute.',
    );
  }

  static Future<bool> _defaultProbe(Uri url, Duration timeout) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final response = await client
          .getUrl(url)
          .then((request) => request.close());
      await response.drain<void>();
      return response.statusCode == HttpStatus.ok;
    } finally {
      client.close(force: true);
    }
  }
}

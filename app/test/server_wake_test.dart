import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/network/server_wake.dart';

void main() {
  test('returns immediately when /health answers on the first attempt', () async {
    final progress = <ServerWakePhase>[];
    final service = ServerWakeService(
      serverUrl: 'https://example.com',
      probe: (url, _) async => true,
    );

    await service.waitUntilAwake(
      onProgress: (p) => progress.add(p.phase),
      deadline: const Duration(seconds: 2),
    );

    expect(progress.single, ServerWakePhase.awake);
  });

  test('reports waking phase and retries until the server answers', () async {
    final phases = <ServerWakePhase>[];
    var attempts = 0;
    final service = ServerWakeService(
      serverUrl: 'https://example.com',
      probe: (url, _) async {
        attempts += 1;
        return attempts >= 3;
      },
    );

    await service.waitUntilAwake(
      onProgress: (p) => phases.add(p.phase),
      deadline: const Duration(seconds: 2),
      retryDelay: const Duration(milliseconds: 1),
    );

    expect(attempts, 3);
    expect(phases, contains(ServerWakePhase.waking));
    expect(phases.last, ServerWakePhase.awake);
  });

  test('throws when the server never wakes up before the deadline', () async {
    final service = ServerWakeService(
      serverUrl: 'https://example.com',
      probe: (url, _) async => false,
    );

    await expectLater(
      service.waitUntilAwake(
        deadline: const Duration(milliseconds: 80),
        attemptTimeout: const Duration(milliseconds: 20),
        retryDelay: const Duration(milliseconds: 10),
      ),
      throwsA(isA<ServerUnreachableException>()),
    );
  });

  test('treats probe exceptions the same as failures', () async {
    var attempts = 0;
    final service = ServerWakeService(
      serverUrl: 'https://example.com',
      probe: (url, _) async {
        attempts += 1;
        if (attempts < 2) {
          throw SocketException('connection reset');        }
        return true;
      },
    );

    await service.waitUntilAwake(
      deadline: const Duration(seconds: 2),
      retryDelay: const Duration(milliseconds: 1),
    );

    expect(attempts, 2);
  });

  test('rejects misconfigured server urls up front', () async {
    final service = ServerWakeService(
      serverUrl: 'not a url',
      probe: (url, _) async => true,
    );

    await expectLater(
      service.waitUntilAwake(),
      throwsA(isA<ServerUnreachableException>()),
    );
  });
}

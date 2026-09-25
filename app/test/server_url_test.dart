import 'package:flutter_test/flutter_test.dart';
import 'package:real_life_amongus_app/core/network/server_url.dart';
import 'package:real_life_amongus_app/core/network/socket_client.dart';

void main() {
  group('serverUrlConfigurationError', () {
    test('the build-time SERVER_URL has no localhost fallback', () {
      expect(defaultServerUrl, isEmpty);
    });

    test('rejects missing or malformed server configuration', () {
      expect(serverUrlConfigurationError(''), isNotNull);
      expect(serverUrlConfigurationError('not a URL'), isNotNull);
      expect(serverUrlConfigurationError('ftp://game.example'), isNotNull);
      expect(
        serverUrlConfigurationError('https://user:pass@example.org'),
        isNotNull,
      );
    });

    test(
      'allows HTTP for local development, but release config requires HTTPS',
      () {
        expect(serverUrlConfigurationError('http://192.168.1.5:3000'), isNull);
        expect(
          serverUrlConfigurationError(
            'http://192.168.1.5:3000',
            requireHttps: true,
          ),
          contains('HTTPS'),
        );
        expect(
          serverUrlConfigurationError(
            'https://game.example.org',
            requireHttps: true,
          ),
          isNull,
        );
      },
    );

    test('a release build cannot target localhost', () {
      expect(
        serverUrlConfigurationError(
          'https://localhost:3000',
          requireHttps: true,
        ),
        contains('local development server'),
      );
      expect(
        serverUrlConfigurationError(
          'https://127.0.0.1:3000',
          requireHttps: true,
        ),
        contains('local development server'),
      );
    });
  });
}

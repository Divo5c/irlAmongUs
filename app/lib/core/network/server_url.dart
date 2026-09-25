const renderBetaServerUrl = 'https://real-life-among-us-beta.onrender.com';

String? serverUrlConfigurationError(
  String configuredUrl, {
  bool requireHttps = false,
}) {
  final value = configuredUrl.trim();
  if (value.isEmpty) {
    return 'This app build has no game server configured. Install a beta build with a server URL.';
  }

  final uri = Uri.tryParse(value);
  if (uri == null ||
      !uri.hasAuthority ||
      uri.host.isEmpty ||
      !const {'http', 'https'}.contains(uri.scheme) ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment) {
    return 'The game server address in this app build is invalid.';
  }

  if (requireHttps && uri.scheme != 'https') {
    return 'This app build must use the secure HTTPS game server address.';
  }

  final host = uri.host.toLowerCase();
  if (requireHttps &&
      (host == 'localhost' ||
          host.endsWith('.localhost') ||
          host == '::1' ||
          host.startsWith('127.'))) {
    return 'This app build points to a local development server. Install a beta build with the public server address.';
  }

  return null;
}

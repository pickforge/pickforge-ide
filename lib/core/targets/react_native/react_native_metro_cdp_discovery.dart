import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';

/// Fetches the body of a Metro inspector URL. Injected so discovery is testable
/// without a live Metro server.
typedef MetroHttpFetcher = Future<String> Function(Uri uri);

/// Default fetcher: a plain HTTP GET via `dart:io` (no extra dependency), with
/// a 1 MB body cap so a hostile/buggy server on the Metro port can't balloon
/// memory before the discovery timeout fires.
Future<String> defaultMetroHttpFetcher(Uri uri) async {
  const maxBytes = 1024 * 1024;
  final client = HttpClient();
  try {
    final request = await client.getUrl(uri);
    final response = await request.close();
    if (response.statusCode != 200) {
      throw HttpException('HTTP ${response.statusCode}', uri: uri);
    }
    final bytes = <int>[];
    await for (final chunk in response) {
      bytes.addAll(chunk);
      if (bytes.length > maxBytes) {
        throw HttpException('Response exceeded $maxBytes bytes', uri: uri);
      }
    }
    return utf8.decode(bytes);
  } finally {
    client.close(force: true);
  }
}

/// A Chrome DevTools Protocol target advertised by Metro's inspector proxy.
class MetroCdpTarget extends Equatable {
  const MetroCdpTarget({
    this.id,
    this.title,
    this.type,
    this.webSocketDebuggerUrl,
    this.description,
    this.deviceName,
    this.vm,
  });

  factory MetroCdpTarget.fromJson(Map<String, Object?> json) => MetroCdpTarget(
        id: _str(json['id']),
        title: _str(json['title']),
        type: _str(json['type']),
        webSocketDebuggerUrl: _str(json['webSocketDebuggerUrl']),
        description: _str(json['description']),
        deviceName: _str(json['deviceName']),
        vm: _str(json['vm']),
      );

  final String? id;
  final String? title;
  final String? type;
  final String? webSocketDebuggerUrl;
  final String? description;
  final String? deviceName;
  final String? vm;

  /// A connectable React Native / Hermes JS debugger target.
  bool get isReactNativeHermesDebuggerTarget {
    final url = webSocketDebuggerUrl;
    if (url == null || url.isEmpty) return false;
    final haystack = '$title $description $vm'.toLowerCase();
    return type == 'node' ||
        haystack.contains('react native') ||
        haystack.contains('hermes');
  }

  static String? _str(Object? value) => value?.toString();

  @override
  List<Object?> get props =>
      [id, title, type, webSocketDebuggerUrl, description, deviceName, vm];
}

/// Discovers CDP debug targets from a running Metro server's inspector proxy.
///
/// Best-effort and side-effect free: any network error, timeout, or malformed
/// response yields an empty list rather than throwing.
class MetroCdpDiscovery {
  MetroCdpDiscovery({
    required String host,
    required int port,
    MetroHttpFetcher fetcher = defaultMetroHttpFetcher,
    Duration timeout = const Duration(seconds: 2),
  })  : _host = _normalizeHost(host),
        _port = port,
        _fetcher = fetcher,
        _timeout = timeout;

  final String _host;
  final int _port;
  final MetroHttpFetcher _fetcher;
  final Duration _timeout;

  /// Queries `/json/list` then `/json`; returns the first valid target list.
  Future<List<MetroCdpTarget>> discoverTargets() async {
    for (final path in const ['/json/list', '/json']) {
      // Structured construction brackets IPv6 hosts (`[::1]`) correctly.
      final uri = Uri(scheme: 'http', host: _host, port: _port, path: path);
      try {
        final body = await _fetcher(uri).timeout(_timeout);
        final decoded = jsonDecode(body);
        if (decoded is! List) continue;
        return decoded
            .whereType<Map<String, Object?>>()
            .map(MetroCdpTarget.fromJson)
            .toList(growable: false);
      } on Object {
        continue;
      }
    }
    return const [];
  }

  /// The first connectable React Native / Hermes target, if any.
  Future<MetroCdpTarget?> discoverReactNativeTarget() async {
    final targets = await discoverTargets();
    for (final target in targets) {
      if (target.isReactNativeHermesDebuggerTarget) return target;
    }
    return null;
  }

  // Metro may bind a wildcard host; the inspector is queried over loopback.
  static String _normalizeHost(String host) {
    final trimmed = host.trim();
    if (trimmed.isEmpty || trimmed == '0.0.0.0' || trimmed == '::') {
      return '127.0.0.1';
    }
    return trimmed;
  }
}

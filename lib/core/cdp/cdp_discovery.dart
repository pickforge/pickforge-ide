import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';

/// Fetches the body of a CDP inspector URL. Injected so discovery is testable
/// without a live server (a Metro inspector proxy or a browser debug port).
typedef CdpHttpFetcher = Future<String> Function(Uri uri);

/// Default fetcher: a plain HTTP GET via `dart:io` (no extra dependency), with
/// a 1 MB body cap so a hostile/buggy server on the debug port can't balloon
/// memory before the discovery timeout fires.
Future<String> defaultCdpHttpFetcher(Uri uri) async {
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

/// A Chrome DevTools Protocol target advertised by a `/json/list` endpoint —
/// either Metro's inspector proxy or a browser's remote-debugging port.
class CdpTarget extends Equatable {
  const CdpTarget({
    this.id,
    this.title,
    this.type,
    this.webSocketDebuggerUrl,
    this.description,
    this.url,
    this.deviceName,
    this.vm,
  });

  factory CdpTarget.fromJson(Map<String, Object?> json) => CdpTarget(
        id: _str(json['id']),
        title: _str(json['title']),
        type: _str(json['type']),
        webSocketDebuggerUrl: _str(json['webSocketDebuggerUrl']),
        description: _str(json['description']),
        url: _str(json['url']),
        deviceName: _str(json['deviceName']),
        vm: _str(json['vm']),
      );

  final String? id;
  final String? title;
  final String? type;
  final String? webSocketDebuggerUrl;
  final String? description;

  /// The page URL (browser targets); null for native/Metro targets.
  final String? url;
  final String? deviceName;
  final String? vm;

  /// Has a connectable inspector websocket.
  bool get isDebuggable {
    final ws = webSocketDebuggerUrl;
    return ws != null && ws.isNotEmpty;
  }

  /// A browser page target with a debugger websocket.
  bool get isPage => isDebuggable && type == 'page';

  static String? _str(Object? value) => value?.toString();

  @override
  List<Object?> get props =>
      [id, title, type, webSocketDebuggerUrl, description, url, deviceName, vm];
}

/// Discovers CDP debug targets from a `/json/list` (then `/json`) endpoint.
///
/// Best-effort and side-effect free: any network error, timeout, or malformed
/// response yields an empty list rather than throwing.
class CdpDiscovery {
  CdpDiscovery({
    required String host,
    required int port,
    CdpHttpFetcher fetcher = defaultCdpHttpFetcher,
    Duration timeout = const Duration(seconds: 2),
  })  : _host = _normalizeHost(host),
        _port = port,
        _fetcher = fetcher,
        _timeout = timeout;

  final String _host;
  final int _port;
  final CdpHttpFetcher _fetcher;
  final Duration _timeout;

  /// Queries `/json/list` then `/json`; returns the first valid target list.
  Future<List<CdpTarget>> discoverTargets() async {
    for (final path in const ['/json/list', '/json']) {
      // Structured construction brackets IPv6 hosts (`[::1]`) correctly.
      final uri = Uri(scheme: 'http', host: _host, port: _port, path: path);
      try {
        final body = await _fetcher(uri).timeout(_timeout);
        final decoded = jsonDecode(body);
        if (decoded is! List) continue;
        return decoded
            .whereType<Map<String, Object?>>()
            .map(CdpTarget.fromJson)
            .toList(growable: false);
      } on Object {
        continue;
      }
    }
    return const [];
  }

  /// The first inspectable browser page target, if any.
  Future<CdpTarget?> discoverPageTarget() async {
    for (final target in await discoverTargets()) {
      if (target.isPage) return target;
    }
    return null;
  }

  // A server may bind a wildcard host; the inspector is queried over loopback.
  static String _normalizeHost(String host) {
    final trimmed = host.trim();
    if (trimmed.isEmpty || trimmed == '0.0.0.0' || trimmed == '::') {
      return '127.0.0.1';
    }
    return trimmed;
  }
}

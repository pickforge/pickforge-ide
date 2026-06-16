import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/react_native/react_native_metro_cdp_discovery.dart';

const _hermesList = '''
[
  {
    "id": "1",
    "title": "Hermes React Native",
    "description": "com.demo",
    "type": "node",
    "vm": "Hermes",
    "deviceName": "Pixel_5",
    "webSocketDebuggerUrl": "ws://localhost:8081/inspector/debug?device=1&page=1"
  }
]
''';

const _mixedList = '''
[
  {"id": "page-1", "title": "About://blank", "type": "page",
   "webSocketDebuggerUrl": "ws://localhost:8081/devtools/page/1"},
  {"id": "rn-1", "title": "React Native", "type": "node", "vm": "Hermes",
   "webSocketDebuggerUrl": "ws://localhost:8081/inspector/debug?device=1"}
]
''';

void main() {
  test('parses a Hermes target and flags it as connectable', () async {
    final requested = <Uri>[];
    final discovery = MetroCdpDiscovery(
      host: '127.0.0.1',
      port: 8081,
      fetcher: (uri) async {
        requested.add(uri);
        return _hermesList;
      },
    );

    final targets = await discovery.discoverTargets();

    expect(requested.single.toString(), 'http://127.0.0.1:8081/json/list');
    expect(targets, hasLength(1));
    final target = targets.single;
    expect(target.id, '1');
    expect(target.vm, 'Hermes');
    expect(
      target.webSocketDebuggerUrl,
      'ws://localhost:8081/inspector/debug?device=1&page=1',
    );
    expect(target.isReactNativeHermesDebuggerTarget, isTrue);
  });

  test('discoverReactNativeTarget picks the RN entry out of mixed targets',
      () async {
    final discovery = MetroCdpDiscovery(
      host: '127.0.0.1',
      port: 8081,
      fetcher: (_) async => _mixedList,
    );
    final target = await discovery.discoverReactNativeTarget();
    expect(target?.id, 'rn-1');
  });

  test('falls back to /json when /json/list errors', () async {
    final requested = <String>[];
    final discovery = MetroCdpDiscovery(
      host: '127.0.0.1',
      port: 8081,
      fetcher: (uri) async {
        requested.add(uri.path);
        if (uri.path == '/json/list') throw const HttpFailure();
        return _hermesList;
      },
    );

    final targets = await discovery.discoverTargets();
    expect(requested, ['/json/list', '/json']);
    expect(targets, hasLength(1));
  });

  test('normalizes a wildcard bind host to loopback', () async {
    final requested = <Uri>[];
    final discovery = MetroCdpDiscovery(
      host: '0.0.0.0',
      port: 9000,
      fetcher: (uri) async {
        requested.add(uri);
        return '[]';
      },
    );
    await discovery.discoverTargets();
    expect(requested.first.host, '127.0.0.1');
    expect(requested.first.port, 9000);
  });

  test('handles IPv6 hosts: wildcard→loopback, ::1 and LAN left alone',
      () async {
    Future<Uri> queriedFor(String host) async {
      Uri? captured;
      await MetroCdpDiscovery(
        host: host,
        port: 8081,
        fetcher: (uri) async {
          captured ??= uri;
          return '[]';
        },
      ).discoverTargets();
      return captured!;
    }

    expect((await queriedFor('::')).host, '127.0.0.1');
    final ipv6 = await queriedFor('::1');
    expect(ipv6.host, '::1');
    expect(ipv6.toString(), 'http://[::1]:8081/json/list');
    expect((await queriedFor('192.168.1.5')).host, '192.168.1.5');
  });

  test('coerces a numeric id to a string', () async {
    final discovery = MetroCdpDiscovery(
      host: 'h',
      port: 1,
      fetcher: (_) async =>
          '[{"id": 7, "type": "node", "webSocketDebuggerUrl": "ws://x/7"}]',
    );
    expect((await discovery.discoverTargets()).single.id, '7');
  });

  test('an empty list is returned without retrying /json', () async {
    final paths = <String>[];
    final discovery = MetroCdpDiscovery(
      host: 'h',
      port: 1,
      fetcher: (uri) async {
        paths.add(uri.path);
        return '[]';
      },
    );
    expect(await discovery.discoverTargets(), isEmpty);
    expect(paths, ['/json/list']);
  });

  test('a target without a webSocketDebuggerUrl is not connectable', () {
    const target = MetroCdpTarget(type: 'node', vm: 'Hermes');
    expect(target.isReactNativeHermesDebuggerTarget, isFalse);
  });

  test('returns empty on errors, non-list JSON, and empty arrays', () async {
    Future<List<MetroCdpTarget>> run(String? body, {bool throwAll = false}) {
      return MetroCdpDiscovery(
        host: 'h',
        port: 1,
        fetcher: (_) async {
          if (throwAll) throw const HttpFailure();
          return body!;
        },
      ).discoverTargets();
    }

    expect(await run(null, throwAll: true), isEmpty);
    expect(await run('{"not": "a list"}'), isEmpty);
    expect(await run('[]'), isEmpty);
    expect(await run('not json at all'), isEmpty);
  });
}

class HttpFailure implements Exception {
  const HttpFailure();
}

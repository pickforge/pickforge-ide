import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/cdp/cdp_discovery.dart';

// The discovery mechanics (/json/list→/json fallback, IPv6 bracketing, 1MB cap,
// error→empty) are exercised by the React Native Metro CDP tests through the
// shared type aliases. This test covers the generic browser-page surface.
const _browserList = '''
[
  {"id": "p1", "type": "page", "title": "Vite App",
   "url": "http://localhost:5173/",
   "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/p1"},
  {"id": "sw", "type": "service_worker", "title": "sw",
   "webSocketDebuggerUrl": "ws://localhost:9222/devtools/sw"},
  {"id": "p2", "type": "page", "title": "blank"}
]
''';

void main() {
  test('discoverPageTarget returns the first inspectable browser page',
      () async {
    final requested = <Uri>[];
    final discovery = CdpDiscovery(
      host: '127.0.0.1',
      port: 9222,
      fetcher: (uri) async {
        requested.add(uri);
        return _browserList;
      },
    );

    final page = await discovery.discoverPageTarget();
    expect(requested.single.toString(), 'http://127.0.0.1:9222/json/list');
    expect(page?.id, 'p1');
    expect(page?.url, 'http://localhost:5173/');
    expect(page!.isPage, isTrue);
  });

  test('a page without a websocket is not an inspectable page', () {
    const target = CdpTarget(type: 'page', title: 'blank');
    expect(target.isDebuggable, isFalse);
    expect(target.isPage, isFalse);
  });

  test('a debuggable non-page target is debuggable but not a page', () {
    const target = CdpTarget(
      type: 'service_worker',
      webSocketDebuggerUrl: 'ws://x/sw',
    );
    expect(target.isDebuggable, isTrue);
    expect(target.isPage, isFalse);
  });
}

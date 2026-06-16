import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';

class _Session extends Mock implements RunSession {}

void main() {
  test('default endpoint uses a Windows named pipe path', () {
    expect(
      defaultEmulatorIpcEndpoint(processId: 42, isWindows: true),
      r'\\.\pipe\pickforge-42-agent',
    );
  });

  test('default endpoint preserves Unix socket path shape', () {
    expect(
      defaultEmulatorIpcEndpoint(
        baseDirectory: '/tmp/pickforge-runtime',
        processId: 42,
        isWindows: false,
      ),
      '/tmp/pickforge-runtime/pickforge-42/agent.sock',
    );
  });

  // The IPC transport binds Unix domain sockets (emulator_ipc_server.dart),
  // which dart:io does not support on Windows — connect never completes and
  // the suite hangs until the CI job timeout.
  final skipOnWindows = Platform.isWindows
      ? 'Emulator IPC uses Unix domain sockets; unsupported on Windows'
      : false;

  test('hotReload route delegates to bound RunSession', skip: skipOnWindows,
      () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);
    final session = _Session();
    when(session.hotReload).thenAnswer((_) async => true);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');

    await server.start();
    server.bindActiveRunSession(session);
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    final reply = await const EmulatorIpcClient().send(
      server.socketPath,
      {'id': 1, 'method': 'hotReload'},
    );

    expect(reply['id'], 1);
    expect(reply['result'], {'ok': true});
    verify(session.hotReload).called(1);
  });

  test('hot_reload route delegates to bound RunSession', skip: skipOnWindows,
      () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);
    final session = _Session();
    when(session.hotReload).thenAnswer((_) async => true);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');

    await server.start();
    server.bindActiveRunSession(session);
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    final reply = await const EmulatorIpcClient().send(
      server.socketPath,
      {'id': 2, 'method': 'hot_reload'},
    );

    expect(reply['id'], 2);
    expect(reply['result'], {'ok': true});
    verify(session.hotReload).called(1);
  });

  test('MCP-named project routes return bound provider data',
      skip: skipOnWindows, () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);
    await server.start();
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    server
      ..bindSelectionProvider(() => {'widgetClass': 'ElevatedButton'})
      ..bindPickHistoryProvider(
        () => [
          {'widgetClass': 'ElevatedButton'},
        ],
      )
      ..bindScreenshotProvider(
        () => {'ok': true, 'path': '/tmp/.pickforge/device-screen.png'},
      )
      ..bindRunLogsProvider(
        () => [
          {'line': 'Reloaded 1 of 2 libraries'},
        ],
      )
      ..bindProjectContextProvider(
        () => {
          'projectRoot': '/tmp/app',
          'files': [
            {'name': 'widget-context.md', 'content': 'Button'},
          ],
        },
      );

    const client = EmulatorIpcClient();
    final selection = await client.send(
      server.socketPath,
      {'id': 1, 'method': 'get_selected_widget'},
    );
    final history = await client.send(
      server.socketPath,
      {'id': 2, 'method': 'list_pickforge_history'},
    );
    final screenshot = await client.send(
      server.socketPath,
      {'id': 3, 'method': 'capture_screenshot'},
    );
    final logs = await client.send(
      server.socketPath,
      {'id': 4, 'method': 'get_run_logs'},
    );
    final context = await client.send(
      server.socketPath,
      {'id': 5, 'method': 'get_project_context'},
    );

    expect(selection['result'], {'widgetClass': 'ElevatedButton'});
    expect(history['result'], [
      {'widgetClass': 'ElevatedButton'},
    ]);
    expect(screenshot['result'], {
      'ok': true,
      'path': '/tmp/.pickforge/device-screen.png',
    });
    expect(logs['result'], [
      {'line': 'Reloaded 1 of 2 libraries'},
    ]);
    expect(context['result'], {
      'projectRoot': '/tmp/app',
      'files': [
        {'name': 'widget-context.md', 'content': 'Button'},
      ],
    });
  });

  test('generic selection/screenshot aliases route to the same providers',
      skip: skipOnWindows, () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);
    await server.start();
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    server
      ..bindSelectionProvider(() => {'widgetClass': 'ElevatedButton'})
      ..bindScreenshotProvider(
        () => {'ok': true, 'path': '/tmp/.pickforge/device-screen.png'},
      );

    const client = EmulatorIpcClient();
    final legacySelection = await client.send(
      server.socketPath,
      {'id': 1, 'method': 'get_selected_widget'},
    );
    final genericSelection = await client.send(
      server.socketPath,
      {'id': 2, 'method': 'get_current_selection'},
    );
    final legacyScreenshot = await client.send(
      server.socketPath,
      {'id': 3, 'method': 'capture_screenshot'},
    );
    final genericScreenshot = await client.send(
      server.socketPath,
      {'id': 4, 'method': 'capture_target_screenshot'},
    );

    expect(genericSelection['result'], legacySelection['result']);
    expect(genericSelection['result'], {'widgetClass': 'ElevatedButton'});
    expect(genericScreenshot['result'], legacyScreenshot['result']);
    expect(genericScreenshot['result'], {
      'ok': true,
      'path': '/tmp/.pickforge/device-screen.png',
    });
  });

  test('generic aliases match legacy names when no providers are bound',
      skip: skipOnWindows, () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);
    await server.start();
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    const client = EmulatorIpcClient();
    final legacySelection = await client.send(
      server.socketPath,
      {'id': 1, 'method': 'get_selected_widget'},
    );
    final genericSelection = await client.send(
      server.socketPath,
      {'id': 2, 'method': 'get_current_selection'},
    );
    final legacyScreenshot = await client.send(
      server.socketPath,
      {'id': 3, 'method': 'capture_screenshot'},
    );
    final genericScreenshot = await client.send(
      server.socketPath,
      {'id': 4, 'method': 'capture_target_screenshot'},
    );

    expect(genericSelection['result'], legacySelection['result']);
    expect(genericSelection['result'], isNull);
    expect(genericScreenshot['result'], legacyScreenshot['result']);
    expect(genericScreenshot['result'], {
      'ok': false,
      'path': null,
      'reason': 'unavailable',
    });
  });

  test('returns error when no run session bound', skip: skipOnWindows,
      () async {
    final endpoint = await _createEndpoint();
    final server = EmulatorIpcServer(socketPath: endpoint.path);

    await server.start();
    addTearDown(server.stop);
    addTearDown(endpoint.dispose);

    final reply = await const EmulatorIpcClient().send(
      server.socketPath,
      {'id': 7, 'method': 'hotReload'},
    );

    expect(reply['id'], 7);
    expect(reply['error'], 'no_active_session');
  });
}

Future<_IpcEndpoint> _createEndpoint() async {
  if (Platform.isWindows) {
    return _IpcEndpoint(
      r'\\.\pipe\pickforge-test-' '${DateTime.now().microsecondsSinceEpoch}',
      () async {},
    );
  }
  final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
  return _IpcEndpoint('${tmp.path}/sock', () => tmp.delete(recursive: true));
}

final class _IpcEndpoint {
  const _IpcEndpoint(this.path, this.dispose);

  final String path;
  final Future<void> Function() dispose;
}

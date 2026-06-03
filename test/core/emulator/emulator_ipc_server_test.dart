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

  test('hotReload route delegates to bound RunSession', () async {
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

  test('returns error when no run session bound', () async {
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

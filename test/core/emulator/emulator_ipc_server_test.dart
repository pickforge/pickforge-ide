import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';

class _Session extends Mock implements RunSession {}

void main() {
  test('hotReload route delegates to bound RunSession', () async {
    if (Platform.isWindows) return;
    final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
    final server = EmulatorIpcServer(socketPath: '${tmp.path}/sock');
    final session = _Session();
    when(session.hotReload).thenAnswer((_) async => true);
    when(() => session.appId).thenReturn('app-1');
    when(() => session.vmServiceUri).thenReturn('ws://x/ws');

    await server.start();
    server.bindActiveRunSession(session);
    addTearDown(server.stop);
    addTearDown(() => tmp.delete(recursive: true));

    final reply =
        await _send(server.socketPath, {'id': 1, 'method': 'hotReload'});

    expect(reply['id'], 1);
    expect(reply['result'], {'ok': true});
    verify(session.hotReload).called(1);
  });

  test('returns error when no run session bound', () async {
    if (Platform.isWindows) return;
    final tmp = await Directory.systemTemp.createTemp('pf-ipc-');
    final server = EmulatorIpcServer(socketPath: '${tmp.path}/sock');

    await server.start();
    addTearDown(server.stop);
    addTearDown(() => tmp.delete(recursive: true));

    final reply =
        await _send(server.socketPath, {'id': 7, 'method': 'hotReload'});

    expect(reply['id'], 7);
    expect(reply['error'], 'no_active_session');
  });
}

Future<Map<String, dynamic>> _send(
  String socketPath,
  Map<String, Object?> request,
) async {
  final socket = await Socket.connect(
    InternetAddress(socketPath, type: InternetAddressType.unix),
    0,
  );
  socket.write('${jsonEncode(request)}\n');
  await socket.flush();
  final reply = await socket
      .cast<List<int>>()
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .first;
  await socket.close();
  return jsonDecode(reply) as Map<String, dynamic>;
}

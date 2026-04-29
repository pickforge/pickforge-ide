import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:pickforge/core/emulator/run_session_controller.dart';

class EmulatorIpcServer {
  EmulatorIpcServer({required this.socketPath});

  final String socketPath;

  ServerSocket? _server;
  RunSession? _session;
  String Function()? _selectionProvider;

  Future<void> start() async {
    final file = File(socketPath);
    if (await file.exists()) {
      await file.delete();
    }
    _server = await ServerSocket.bind(
      InternetAddress(socketPath, type: InternetAddressType.unix),
      0,
    );
    _server!.listen(_handle);
  }

  Future<void> stop() async {
    await _server?.close();
    _server = null;
    final file = File(socketPath);
    if (await file.exists()) {
      await file.delete();
    }
  }

  void bindActiveRunSession(RunSession? session) => _session = session;

  void bindSelectionProvider(String Function()? provider) {
    _selectionProvider = provider;
  }

  void _handle(Socket socket) {
    socket
        .cast<List<int>>()
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) async {
      final response = await _dispatch(line);
      socket.write('${jsonEncode(response)}\n');
      await socket.flush();
    });
  }

  Future<Map<String, Object?>> _dispatch(String line) async {
    try {
      final request = jsonDecode(line) as Map<String, dynamic>;
      final id = request['id'];
      final method = request['method'] as String?;
      Object? result;
      Object? error;
      switch (method) {
        case 'getStatus':
          result = {
            'state': _session == null ? 'idle' : 'running',
            'appId': _session?.appId,
            'vmServiceUri': _session?.vmServiceUri,
          };
        case 'hotReload':
          final session = _session;
          if (session == null) {
            error = 'no_active_session';
          } else {
            await session.hotReload();
            result = {'ok': true};
          }
        case 'hotRestart':
          final session = _session;
          if (session == null) {
            error = 'no_active_session';
          } else {
            await session.hotRestart();
            result = {'ok': true};
          }
        case 'getVmServiceUri':
          result = _session?.vmServiceUri;
        case 'getCurrentSelection':
          result = _selectionProvider?.call();
        default:
          error = 'unknown_method';
      }
      return error == null
          ? {'id': id, 'result': result}
          : {'id': id, 'error': error};
    } on Object catch (error) {
      return {'error': error.toString()};
    }
  }
}

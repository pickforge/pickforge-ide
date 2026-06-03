import 'dart:async';
import 'dart:convert';
import 'dart:ffi';
import 'dart:io';
import 'dart:isolate';

import 'package:ffi/ffi.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';

typedef EmulatorIpcRequestHandler = Future<Map<String, Object?>> Function(
  String line,
);

typedef EmulatorIpcProvider = FutureOr<Object?> Function();

abstract interface class EmulatorIpcTransport {
  String get endpoint;
  Future<void> start(EmulatorIpcRequestHandler handler);
  Future<void> stop();
}

String defaultEmulatorIpcEndpoint({
  String? baseDirectory,
  int? processId,
  bool? isWindows,
}) {
  final currentPid = processId ?? pid;
  if (isWindows ?? Platform.isWindows) {
    return r'\\.\pipe\pickforge-' '$currentPid-agent';
  }
  final base = baseDirectory ??
      Platform.environment['XDG_RUNTIME_DIR'] ??
      Directory.systemTemp.path;
  return '$base/pickforge-$currentPid/agent.sock';
}

EmulatorIpcTransport defaultEmulatorIpcTransport(String endpoint) {
  if (Platform.isWindows) {
    return WindowsNamedPipeEmulatorIpcTransport(pipeName: endpoint);
  }
  return UnixSocketEmulatorIpcTransport(socketPath: endpoint);
}

class EmulatorIpcServer {
  EmulatorIpcServer({
    required String socketPath,
    EmulatorIpcTransport? transport,
  }) : _transport = transport ?? defaultEmulatorIpcTransport(socketPath);

  final EmulatorIpcTransport _transport;
  RunSession? _session;
  EmulatorIpcProvider? _selectionProvider;
  EmulatorIpcProvider? _pickHistoryProvider;
  EmulatorIpcProvider? _screenshotProvider;
  EmulatorIpcProvider? _runLogsProvider;
  EmulatorIpcProvider? _projectContextProvider;

  String get socketPath => _transport.endpoint;

  Future<void> start() => _transport.start(_dispatch);

  Future<void> stop() => _transport.stop();

  // ignore: use_setters_to_change_properties, reason: Binds an IPC target.
  void bindActiveRunSession(RunSession? session) => _session = session;

  // ignore: use_setters_to_change_properties, reason: Binds a callback target.
  void bindSelectionProvider(EmulatorIpcProvider? provider) {
    _selectionProvider = provider;
  }

  // ignore: use_setters_to_change_properties, reason: Binds a callback target.
  void bindPickHistoryProvider(EmulatorIpcProvider? provider) {
    _pickHistoryProvider = provider;
  }

  // ignore: use_setters_to_change_properties, reason: Binds a callback target.
  void bindScreenshotProvider(EmulatorIpcProvider? provider) {
    _screenshotProvider = provider;
  }

  // ignore: use_setters_to_change_properties, reason: Binds a callback target.
  void bindRunLogsProvider(EmulatorIpcProvider? provider) {
    _runLogsProvider = provider;
  }

  // ignore: use_setters_to_change_properties, reason: Binds a callback target.
  void bindProjectContextProvider(EmulatorIpcProvider? provider) {
    _projectContextProvider = provider;
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
        case 'hot_reload':
          final session = _session;
          if (session == null) {
            error = 'no_active_session';
          } else {
            await session.hotReload();
            result = {'ok': true};
          }
        case 'hotRestart':
        case 'hot_restart':
          final session = _session;
          if (session == null) {
            error = 'no_active_session';
          } else {
            await session.hotRestart();
            result = {'ok': true};
          }
        case 'getVmServiceUri':
        case 'get_vm_service_uri':
          result = _session?.vmServiceUri;
        case 'getCurrentSelection':
        case 'get_selected_widget':
          result = await _selectionProvider?.call();
        case 'list_pickforge_history':
          result = await _pickHistoryProvider?.call() ?? const [];
        case 'capture_screenshot':
          result = await _screenshotProvider?.call() ??
              const {
                'ok': false,
                'path': null,
                'reason': 'unavailable',
              };
        case 'get_run_logs':
          result = await _runLogsProvider?.call() ?? const [];
        case 'get_project_context':
          result = await _projectContextProvider?.call() ??
              const {
                'projectRoot': null,
                'files': <Object?>[],
              };
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

class EmulatorIpcClient {
  const EmulatorIpcClient();

  Future<Map<String, dynamic>> send(
    String endpoint,
    Map<String, Object?> request,
  ) {
    if (Platform.isWindows) {
      return _sendWindowsNamedPipe(endpoint, request);
    }
    return _sendUnixSocket(endpoint, request);
  }
}

class UnixSocketEmulatorIpcTransport implements EmulatorIpcTransport {
  UnixSocketEmulatorIpcTransport({required this.socketPath});

  final String socketPath;
  ServerSocket? _server;
  StreamSubscription<Socket>? _subscription;

  @override
  String get endpoint => socketPath;

  @override
  Future<void> start(EmulatorIpcRequestHandler handler) async {
    if (_server != null) return;
    final file = File(socketPath);
    if (file.existsSync()) {
      file.deleteSync();
    }
    final server = await ServerSocket.bind(
      InternetAddress(socketPath, type: InternetAddressType.unix),
      0,
    );
    _server = server;
    _subscription = server.listen((socket) => _handle(socket, handler));
  }

  @override
  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    await _server?.close();
    _server = null;
    final file = File(socketPath);
    if (file.existsSync()) {
      file.deleteSync();
    }
  }

  void _handle(Socket socket, EmulatorIpcRequestHandler handler) {
    socket
        .cast<List<int>>()
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen(
      (line) async {
        final response = await handler(line);
        socket.write('${jsonEncode(response)}\n');
        await socket.flush();
      },
      onDone: socket.destroy,
    );
  }
}

class WindowsNamedPipeEmulatorIpcTransport implements EmulatorIpcTransport {
  WindowsNamedPipeEmulatorIpcTransport({required this.pipeName});

  final String pipeName;
  Isolate? _isolate;
  ReceivePort? _requests;
  StreamSubscription<dynamic>? _requestSub;

  @override
  String get endpoint => pipeName;

  @override
  Future<void> start(EmulatorIpcRequestHandler handler) async {
    if (_isolate != null) return;
    final ready = ReceivePort();
    final requests = ReceivePort();
    _requests = requests;
    _requestSub = requests.listen(
      (message) => unawaited(_handleRequest(message, handler)),
    );
    try {
      _isolate = await Isolate.spawn(
        _windowsNamedPipeServerMain,
        [pipeName, requests.sendPort, ready.sendPort],
        debugName: 'pickforge-ipc',
      );
      final message = await ready.first.timeout(const Duration(seconds: 5));
      if (message == true) return;
      throw StateError(message.toString());
    } on Object {
      await stop();
      rethrow;
    } finally {
      ready.close();
    }
  }

  @override
  Future<void> stop() async {
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    await _requestSub?.cancel();
    _requestSub = null;
    _requests?.close();
    _requests = null;
  }

  Future<void> _handleRequest(
    Object? message,
    EmulatorIpcRequestHandler handler,
  ) async {
    if (message is! List<Object?> || message.length != 2) return;
    final line = message[0];
    final responsePort = message[1];
    if (line is! String || responsePort is! SendPort) return;
    try {
      final response = await handler(line);
      responsePort.send(response);
    } on Object catch (error) {
      responsePort.send({'error': error.toString()});
    }
  }
}

Future<Map<String, dynamic>> _sendUnixSocket(
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

Future<Map<String, dynamic>> _sendWindowsNamedPipe(
  String pipeName,
  Map<String, Object?> request,
) async {
  final api = _WindowsNamedPipeApi();
  final handle = api.openClient(pipeName);
  try {
    api
      ..write(handle, utf8.encode('${jsonEncode(request)}\n'))
      ..flush(handle);
    final line = api.readLine(handle);
    return jsonDecode(line) as Map<String, dynamic>;
  } finally {
    api.close(handle);
  }
}

Future<void> _windowsNamedPipeServerMain(List<Object?> args) async {
  final pipeName = args[0]! as String;
  final requests = args[1]! as SendPort;
  final ready = args[2]! as SendPort;
  final api = _WindowsNamedPipeApi();
  var readySent = false;
  try {
    while (true) {
      final handle = api.createServer(pipeName);
      if (!readySent) {
        ready.send(true);
        readySent = true;
      }
      try {
        api.connect(handle);
        await _serveWindowsPipeClient(api, handle, requests);
      } finally {
        api
          ..disconnect(handle)
          ..close(handle);
      }
    }
  } on Object catch (error) {
    if (!readySent) {
      ready.send(error.toString());
    }
    rethrow;
  }
}

Future<void> _serveWindowsPipeClient(
  _WindowsNamedPipeApi api,
  int handle,
  SendPort requests,
) async {
  final pending = <int>[];
  while (true) {
    final chunk = api.read(handle);
    if (chunk == null) return;
    pending.addAll(chunk);
    while (true) {
      final newline = pending.indexOf(10);
      if (newline == -1) break;
      final line = utf8.decode(pending.take(newline).toList());
      pending.removeRange(0, newline + 1);
      final responsePort = ReceivePort();
      requests.send([line, responsePort.sendPort]);
      final response = await responsePort.first;
      responsePort.close();
      api
        ..write(handle, utf8.encode('${jsonEncode(response)}\n'))
        ..flush(handle);
    }
  }
}

final class _WindowsNamedPipeApi {
  _WindowsNamedPipeApi() : _kernel32 = DynamicLibrary.open('kernel32.dll');

  final DynamicLibrary _kernel32;

  late final int Function(
    Pointer<Utf16>,
    int,
    int,
    int,
    int,
    int,
    int,
    Pointer<Void>,
  ) _createNamedPipe = _kernel32.lookupFunction<
      IntPtr Function(
        Pointer<Utf16>,
        Uint32,
        Uint32,
        Uint32,
        Uint32,
        Uint32,
        Uint32,
        Pointer<Void>,
      ),
      int Function(
        Pointer<Utf16>,
        int,
        int,
        int,
        int,
        int,
        int,
        Pointer<Void>,
      )>('CreateNamedPipeW');
  late final int Function(int, Pointer<Void>) _connectNamedPipe =
      _kernel32.lookupFunction<Int32 Function(IntPtr, Pointer<Void>),
          int Function(int, Pointer<Void>)>('ConnectNamedPipe');
  late final int Function(int) _disconnectNamedPipe =
      _kernel32.lookupFunction<Int32 Function(IntPtr), int Function(int)>(
    'DisconnectNamedPipe',
  );
  late final int Function(
    Pointer<Utf16>,
    int,
    int,
    Pointer<Void>,
    int,
    int,
    int,
  ) _createFile = _kernel32.lookupFunction<
      IntPtr Function(
        Pointer<Utf16>,
        Uint32,
        Uint32,
        Pointer<Void>,
        Uint32,
        Uint32,
        IntPtr,
      ),
      int Function(
        Pointer<Utf16>,
        int,
        int,
        Pointer<Void>,
        int,
        int,
        int,
      )>('CreateFileW');
  late final int Function(Pointer<Utf16>, int) _waitNamedPipe =
      _kernel32.lookupFunction<Int32 Function(Pointer<Utf16>, Uint32),
          int Function(Pointer<Utf16>, int)>('WaitNamedPipeW');
  late final int Function(
    int,
    Pointer<Void>,
    int,
    Pointer<Uint32>,
    Pointer<Void>,
  ) _readFile = _kernel32.lookupFunction<
      Int32 Function(
        IntPtr,
        Pointer<Void>,
        Uint32,
        Pointer<Uint32>,
        Pointer<Void>,
      ),
      int Function(
        int,
        Pointer<Void>,
        int,
        Pointer<Uint32>,
        Pointer<Void>,
      )>('ReadFile');
  late final int Function(
    int,
    Pointer<Void>,
    int,
    Pointer<Uint32>,
    Pointer<Void>,
  ) _writeFile = _kernel32.lookupFunction<
      Int32 Function(
        IntPtr,
        Pointer<Void>,
        Uint32,
        Pointer<Uint32>,
        Pointer<Void>,
      ),
      int Function(
        int,
        Pointer<Void>,
        int,
        Pointer<Uint32>,
        Pointer<Void>,
      )>('WriteFile');
  late final int Function(int) _flushFileBuffers =
      _kernel32.lookupFunction<Int32 Function(IntPtr), int Function(int)>(
    'FlushFileBuffers',
  );
  late final int Function(int) _closeHandle = _kernel32
      .lookupFunction<Int32 Function(IntPtr), int Function(int)>('CloseHandle');
  late final int Function() _getLastError =
      _kernel32.lookupFunction<Uint32 Function(), int Function()>(
    'GetLastError',
  );

  int createServer(String pipeName) {
    final name = pipeName.toNativeUtf16();
    try {
      final handle = _createNamedPipe(
        name,
        _pipeAccessDuplex,
        _pipeTypeByte | _pipeReadmodeByte | _pipeWait,
        _pipeUnlimitedInstances,
        _pipeBufferSize,
        _pipeBufferSize,
        0,
        nullptr,
      );
      if (handle == _invalidHandleValue) {
        throw _WindowsPipeException('CreateNamedPipeW', _getLastError());
      }
      return handle;
    } finally {
      calloc.free(name);
    }
  }

  int openClient(String pipeName) {
    final name = pipeName.toNativeUtf16();
    try {
      final waited = _waitNamedPipe(name, _clientConnectTimeoutMs);
      if (waited == 0) {
        throw _WindowsPipeException('WaitNamedPipeW', _getLastError());
      }
      final handle = _createFile(
        name,
        _genericRead | _genericWrite,
        0,
        nullptr,
        _openExisting,
        0,
        0,
      );
      if (handle == _invalidHandleValue) {
        throw _WindowsPipeException('CreateFileW', _getLastError());
      }
      return handle;
    } finally {
      calloc.free(name);
    }
  }

  void connect(int handle) {
    final connected = _connectNamedPipe(handle, nullptr);
    if (connected != 0) return;
    final error = _getLastError();
    if (error == _errorPipeConnected) return;
    throw _WindowsPipeException('ConnectNamedPipe', error);
  }

  List<int>? read(int handle) {
    final buffer = calloc<Uint8>(_pipeBufferSize);
    final bytesRead = calloc<Uint32>();
    try {
      final ok = _readFile(
        handle,
        buffer.cast<Void>(),
        _pipeBufferSize,
        bytesRead,
        nullptr,
      );
      if (ok == 0) {
        final error = _getLastError();
        if (error == _errorBrokenPipe || error == _errorNoData) return null;
        throw _WindowsPipeException('ReadFile', error);
      }
      if (bytesRead.value == 0) return null;
      return buffer.asTypedList(bytesRead.value).toList(growable: false);
    } finally {
      calloc
        ..free(buffer)
        ..free(bytesRead);
    }
  }

  String readLine(int handle) {
    final pending = <int>[];
    while (true) {
      final chunk = read(handle);
      if (chunk == null) break;
      pending.addAll(chunk);
      final newline = pending.indexOf(10);
      if (newline != -1) {
        return utf8.decode(pending.take(newline).toList());
      }
    }
    throw const FormatException('No JSON-RPC response received');
  }

  void write(int handle, List<int> bytes) {
    final buffer = calloc<Uint8>(bytes.length);
    final bytesWritten = calloc<Uint32>();
    try {
      buffer.asTypedList(bytes.length).setAll(0, bytes);
      var offset = 0;
      while (offset < bytes.length) {
        final remaining = bytes.length - offset;
        final ok = _writeFile(
          handle,
          (buffer + offset).cast<Void>(),
          remaining,
          bytesWritten,
          nullptr,
        );
        if (ok == 0) {
          throw _WindowsPipeException('WriteFile', _getLastError());
        }
        offset += bytesWritten.value;
      }
    } finally {
      calloc
        ..free(buffer)
        ..free(bytesWritten);
    }
  }

  void flush(int handle) {
    final ok = _flushFileBuffers(handle);
    if (ok == 0) {
      throw _WindowsPipeException('FlushFileBuffers', _getLastError());
    }
  }

  void disconnect(int handle) {
    _disconnectNamedPipe(handle);
  }

  void close(int handle) {
    _closeHandle(handle);
  }
}

final class _WindowsPipeException implements Exception {
  const _WindowsPipeException(this.operation, this.errorCode);

  final String operation;
  final int errorCode;

  @override
  String toString() => '$operation failed with Windows error $errorCode';
}

const _pipeAccessDuplex = 0x00000003;
const _pipeTypeByte = 0x00000000;
const _pipeReadmodeByte = 0x00000000;
const _pipeWait = 0x00000000;
const _pipeUnlimitedInstances = 255;
const _pipeBufferSize = 65536;
const _clientConnectTimeoutMs = 5000;
const _genericRead = 0x80000000;
const _genericWrite = 0x40000000;
const _openExisting = 3;
const _invalidHandleValue = -1;
const _errorBrokenPipe = 109;
const _errorNoData = 232;
const _errorPipeConnected = 535;

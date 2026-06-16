import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

typedef PickforgeIpcSender = Future<Map<String, dynamic>> Function(
  String endpoint,
  Map<String, Object?> request,
);

class PickforgeMcpServer {
  PickforgeMcpServer({
    required String projectRoot,
    PickforgeIpcSender? ipcSender,
    ContextStorageService? storage,
    Map<String, String>? environment,
  })  : _projectRoot = projectRoot,
        _ipcSender = ipcSender ?? const EmulatorIpcClient().send,
        _storage = storage ?? ContextStorageService(),
        _environment = environment ?? Platform.environment;

  final String _projectRoot;
  final PickforgeIpcSender _ipcSender;
  final ContextStorageService _storage;
  final Map<String, String> _environment;
  var _nextIpcId = 1;

  static const _protocolVersion = '2025-06-18';
  static const _serverVersion = '0.1.0';

  Future<void> serve({
    required Stream<List<int>> input,
    required IOSink output,
  }) async {
    await for (final line
        in input.transform(utf8.decoder).transform(const LineSplitter())) {
      final response = await handleLine(line);
      if (response != null) {
        output.writeln(jsonEncode(response));
        await output.flush();
      }
    }
  }

  Future<Map<String, Object?>?> handleLine(String line) async {
    Object? decoded;
    try {
      decoded = jsonDecode(line);
    } on Object {
      return _error(null, -32700, 'Parse error');
    }
    if (decoded is! Map) {
      return _error(null, -32600, 'Invalid Request');
    }
    final request = Map<String, Object?>.from(decoded);
    final id = request['id'];
    final method = request['method'];
    if (method is! String) {
      return _error(id, -32600, 'Invalid Request');
    }
    if (id == null && method.startsWith('notifications/')) {
      return null;
    }

    switch (method) {
      case 'initialize':
        return _result(id, {
          'protocolVersion': _protocolVersion,
          'capabilities': {
            'tools': {'listChanged': false},
          },
          'serverInfo': {
            'name': 'pickforge-mcp',
            'version': _serverVersion,
          },
        });
      case 'ping':
        return _result(id, const <String, Object?>{});
      case 'tools/list':
        return _result(id, {
          'tools': _tools,
        });
      case 'tools/call':
        return _callTool(id, request['params']);
      default:
        return _error(id, -32601, 'Method not found');
    }
  }

  Future<Map<String, Object?>> _callTool(Object? id, Object? params) async {
    if (params is! Map) {
      return _error(id, -32602, 'Invalid params');
    }
    final name = params['name'];
    if (name is! String || !_toolNames.contains(name)) {
      return _error(id, -32602, 'Unknown tool');
    }

    final endpoint = await _readEndpoint();
    if (endpoint == null) {
      return _toolResult(
        id,
        {'error': 'Pickforge IPC endpoint not found.'},
        isError: true,
      );
    }

    try {
      final reply = await _ipcSender(endpoint, {
        'id': _nextIpcId++,
        'method': name,
      });
      if (reply['error'] case final error?) {
        return _toolResult(id, {'error': error.toString()}, isError: true);
      }
      return _toolResult(id, reply['result']);
    } on Object catch (error) {
      return _toolResult(id, {'error': error.toString()}, isError: true);
    }
  }

  Future<String?> _readEndpoint() async {
    // 1. An explicit endpoint env var is already the live socket — use it.
    final explicit = _environment['PICKFORGE_IPC_ENDPOINT']?.trim();
    if (explicit != null && explicit.isNotEmpty) return explicit;

    // 2. A context dir env var points at the discovery file directly, with no
    //    need to re-resolve storage.
    final contextDir = _environment['PICKFORGE_CONTEXT_DIR']?.trim();
    if (contextDir != null && contextDir.isNotEmpty) {
      return _readSockFile(p.join(contextDir, 'ipc.sock-path'));
    }

    // 3. Fall back to resolving the project's storage layout.
    final resolved = await _storage.resolve(_projectRoot);
    return _readSockFile(resolved.ipcSockPath);
  }

  Future<String?> _readSockFile(String path) async {
    final file = File(path);
    if (!file.existsSync()) return null;
    final endpoint = (await file.readAsString()).trim();
    return endpoint.isEmpty ? null : endpoint;
  }
}

Map<String, Object?> _result(Object? id, Object? result) => {
      'jsonrpc': '2.0',
      'id': id,
      'result': result,
    };

Map<String, Object?> _error(Object? id, int code, String message) => {
      'jsonrpc': '2.0',
      'id': id,
      'error': {
        'code': code,
        'message': message,
      },
    };

Map<String, Object?> _toolResult(
  Object? id,
  Object? result, {
  bool isError = false,
}) =>
    _result(id, {
      'content': [
        {
          'type': 'text',
          'text': const JsonEncoder.withIndent('  ').convert(result),
        },
      ],
      'isError': isError,
    });

const List<Map<String, Object?>> _tools = [
  {
    'name': 'get_selected_widget',
    'title': 'Get selected widget',
    'description': 'Return the active Flutter inspector widget selection.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'get_current_selection',
    'title': 'Get current selection',
    'description': 'Return the active target selection (generic alias of '
        'get_selected_widget).',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'list_pickforge_history',
    'title': 'List Pickforge history',
    'description': 'Return recent widget picks for the active project.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'capture_screenshot',
    'title': 'Capture screenshot',
    'description': 'Capture the active target screen into the context dir.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'capture_target_screenshot',
    'title': 'Capture target screenshot',
    'description': 'Capture the active target screen into the context dir '
        '(generic alias of capture_screenshot).',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'hot_reload',
    'title': 'Hot reload',
    'description': 'Trigger hot reload on the active Flutter run session.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'get_run_logs',
    'title': 'Get run logs',
    'description': 'Return active project run log entries.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'get_project_context',
    'title': 'Get project context',
    'description': 'Return project context text and screenshot metadata.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
];

final Set<String> _toolNames =
    _tools.map((tool) => tool['name']).whereType<String>().toSet();

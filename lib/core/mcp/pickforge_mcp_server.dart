import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';

typedef PickforgeIpcSender = Future<Map<String, dynamic>> Function(
  String endpoint,
  Map<String, Object?> request,
);

class PickforgeMcpServer {
  PickforgeMcpServer({
    required String projectRoot,
    PickforgeIpcSender? ipcSender,
  })  : _projectRoot = projectRoot,
        _ipcSender = ipcSender ?? const EmulatorIpcClient().send;

  final String _projectRoot;
  final PickforgeIpcSender _ipcSender;
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
    final file = File(p.join(_projectRoot, '.pickforge', 'ipc.sock-path'));
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
    'name': 'list_pickforge_history',
    'title': 'List Pickforge history',
    'description': 'Return recent widget picks for the active project.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
  {
    'name': 'capture_screenshot',
    'title': 'Capture screenshot',
    'description': 'Capture the active target screen into .pickforge.',
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
    'description': 'Return .pickforge context text and screenshot metadata.',
    'inputSchema': {'type': 'object', 'properties': <String, Object?>{}},
  },
];

final Set<String> _toolNames =
    _tools.map((tool) => tool['name']).whereType<String>().toSet();

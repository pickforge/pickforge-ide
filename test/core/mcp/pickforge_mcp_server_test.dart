import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/mcp/pickforge_mcp_server.dart';

void main() {
  test('initialize returns MCP server capabilities', () async {
    final server = PickforgeMcpServer(projectRoot: Directory.current.path);

    final response = await server.handleLine(
      jsonEncode({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}),
    );

    expect(response?['jsonrpc'], '2.0');
    expect(response?['id'], 1);
    final result = response!['result']! as Map<String, Object?>;
    expect(result['protocolVersion'], '2025-06-18');
    expect(result['capabilities'], {
      'tools': {'listChanged': false},
    });
  });

  test('tools/list exposes Pickforge IPC tools', () async {
    final server = PickforgeMcpServer(projectRoot: Directory.current.path);

    final response = await server.handleLine(
      jsonEncode({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}),
    );

    final result = response!['result']! as Map<String, Object?>;
    final tools =
        (result['tools']! as List<Object?>).cast<Map<String, Object?>>();
    expect(
      tools.map((tool) => tool['name']),
      containsAll([
        'get_selected_widget',
        'list_pickforge_history',
        'capture_screenshot',
        'hot_reload',
        'get_run_logs',
        'get_project_context',
      ]),
    );
  });

  test('tools/call forwards to project IPC endpoint', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-project-');
    addTearDown(() => project.delete(recursive: true));
    final pickforge = Directory(p.join(project.path, '.pickforge'));
    await pickforge.create();
    await File(p.join(pickforge.path, 'ipc.sock-path'))
        .writeAsString('/tmp/pickforge.sock\n');
    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {
          'id': request['id'],
          'result': {'widgetClass': 'ElevatedButton'},
        };
      },
    );

    final response = await server.handleLine(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': 3,
        'method': 'tools/call',
        'params': {
          'name': 'get_selected_widget',
          'arguments': <String, Object?>{},
        },
      }),
    );

    expect(calls.single, {
      'endpoint': '/tmp/pickforge.sock',
      'id': 1,
      'method': 'get_selected_widget',
    });
    final result = response!['result']! as Map<String, Object?>;
    expect(result['isError'], isFalse);
    final content =
        (result['content']! as List<Object?>).single! as Map<String, Object?>;
    expect(content['type'], 'text');
    expect(content['text'], contains('ElevatedButton'));
  });

  test('tools/call returns tool error when endpoint is missing', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-project-');
    addTearDown(() => project.delete(recursive: true));
    final server = PickforgeMcpServer(projectRoot: project.path);

    final response = await server.handleLine(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': 4,
        'method': 'tools/call',
        'params': {
          'name': 'hot_reload',
          'arguments': <String, Object?>{},
        },
      }),
    );

    final result = response!['result']! as Map<String, Object?>;
    expect(result['isError'], isTrue);
    final content =
        (result['content']! as List<Object?>).single! as Map<String, Object?>;
    expect(content['text'], contains('IPC endpoint not found'));
  });

  test('notifications do not produce a response', () async {
    final server = PickforgeMcpServer(projectRoot: Directory.current.path);

    final response = await server.handleLine(
      jsonEncode({'jsonrpc': '2.0', 'method': 'notifications/initialized'}),
    );

    expect(response, isNull);
  });
}

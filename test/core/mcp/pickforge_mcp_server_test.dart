import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/mcp/pickforge_mcp_server.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

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
        'get_current_selection',
        'list_pickforge_history',
        'list_pick_history',
        'list_target_capabilities',
        'capture_screenshot',
        'capture_target_screenshot',
        'hot_reload',
        'get_run_logs',
        'get_project_context',
      ]),
    );
  });

  test('generic alias tools forward their method name verbatim', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-alias-');
    addTearDown(() => project.delete(recursive: true));
    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: const {'PICKFORGE_IPC_ENDPOINT': '/run/alias.sock'},
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {
          'id': request['id'],
          'result': {'widgetClass': 'TextButton'},
        };
      },
    );

    for (final name in ['get_current_selection', 'capture_target_screenshot']) {
      final response = await server.handleLine(
        jsonEncode({
          'jsonrpc': '2.0',
          'id': 10,
          'method': 'tools/call',
          'params': {'name': name, 'arguments': <String, Object?>{}},
        }),
      );
      final result = response!['result']! as Map<String, Object?>;
      expect(result['isError'], isFalse);
    }

    expect(calls.map((call) => call['method']), [
      'get_current_selection',
      'capture_target_screenshot',
    ]);
    expect(
      calls.every((call) => call['endpoint'] == '/run/alias.sock'),
      isTrue,
    );
  });

  test('tools/call forwards to project IPC endpoint', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-project-');
    addTearDown(() => project.delete(recursive: true));
    final pickforge = Directory(p.join(project.path, '.pickforge'));
    await pickforge.create();
    await File(p.join(pickforge.path, '.gitignore')).writeAsString('*\n');
    await File(p.join(pickforge.path, 'ipc.sock-path'))
        .writeAsString('/tmp/pickforge.sock\n');
    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: const <String, String>{},
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
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: const <String, String>{},
    );

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

  test('tools/call reads the IPC endpoint from the home context dir', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-home-');
    addTearDown(() => project.delete(recursive: true));
    final home = await Directory.systemTemp.createTemp('pf-mcp-home-dir-');
    addTearDown(() => home.delete(recursive: true));

    final storage = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': home.path},
      isWindows: false,
    );
    final resolved = await storage.resolve(project.path);
    await Directory(resolved.contextDir).create(recursive: true);
    await File(resolved.ipcSockPath)
        .writeAsString('/tmp/pickforge-home.sock\n');

    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      storage: storage,
      environment: const <String, String>{},
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {
          'id': request['id'],
          'result': {'widgetClass': 'TextButton'},
        };
      },
    );

    final response = await server.handleLine(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': 5,
        'method': 'tools/call',
        'params': {
          'name': 'get_selected_widget',
          'arguments': <String, Object?>{},
        },
      }),
    );

    expect(calls.single['endpoint'], '/tmp/pickforge-home.sock');
    final result = response!['result']! as Map<String, Object?>;
    expect(result['isError'], isFalse);
  });

  Future<Map<String, Object?>?> callGetSelected(
    PickforgeMcpServer server, {
    int id = 9,
  }) {
    return server.handleLine(
      jsonEncode({
        'jsonrpc': '2.0',
        'id': id,
        'method': 'tools/call',
        'params': {
          'name': 'get_selected_widget',
          'arguments': <String, Object?>{},
        },
      }),
    );
  }

  test('PICKFORGE_IPC_ENDPOINT is used directly without resolving storage',
      () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-env-');
    addTearDown(() => project.delete(recursive: true));
    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: const {'PICKFORGE_IPC_ENDPOINT': '/run/direct.sock'},
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {'id': request['id'], 'result': <String, Object?>{}};
      },
    );

    final response = await callGetSelected(server);

    expect(calls.single['endpoint'], '/run/direct.sock');
    final result = response!['result']! as Map<String, Object?>;
    expect(result['isError'], isFalse);
  });

  test('PICKFORGE_CONTEXT_DIR reads ipc.sock-path from that dir', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-ctx-');
    addTearDown(() => project.delete(recursive: true));
    final contextDir = await Directory.systemTemp.createTemp('pf-mcp-ctxdir-');
    addTearDown(() => contextDir.delete(recursive: true));
    await File(p.join(contextDir.path, 'ipc.sock-path'))
        .writeAsString('/run/ctx.sock\n');

    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: {'PICKFORGE_CONTEXT_DIR': contextDir.path},
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {'id': request['id'], 'result': <String, Object?>{}};
      },
    );

    final response = await callGetSelected(server);

    expect(calls.single['endpoint'], '/run/ctx.sock');
    final result = response!['result']! as Map<String, Object?>;
    expect(result['isError'], isFalse);
  });

  test('PICKFORGE_IPC_ENDPOINT wins over PICKFORGE_CONTEXT_DIR', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-prec-');
    addTearDown(() => project.delete(recursive: true));
    final contextDir = await Directory.systemTemp.createTemp('pf-mcp-precdir-');
    addTearDown(() => contextDir.delete(recursive: true));
    await File(p.join(contextDir.path, 'ipc.sock-path'))
        .writeAsString('/run/ctx.sock\n');

    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: {
        'PICKFORGE_IPC_ENDPOINT': '/run/direct.sock',
        'PICKFORGE_CONTEXT_DIR': contextDir.path,
      },
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {'id': request['id'], 'result': <String, Object?>{}};
      },
    );

    await callGetSelected(server);

    expect(calls.single['endpoint'], '/run/direct.sock');
  });

  test('falls back to resolved storage when no env vars are set', () async {
    final project = await Directory.systemTemp.createTemp('pf-mcp-fallback-');
    addTearDown(() => project.delete(recursive: true));
    final pickforge = Directory(p.join(project.path, '.pickforge'));
    await pickforge.create();
    await File(p.join(pickforge.path, '.gitignore')).writeAsString('*\n');
    await File(p.join(pickforge.path, 'ipc.sock-path'))
        .writeAsString('/run/fallback.sock\n');

    final calls = <Map<String, Object?>>[];
    final server = PickforgeMcpServer(
      projectRoot: project.path,
      environment: const <String, String>{},
      ipcSender: (endpoint, request) async {
        calls.add({'endpoint': endpoint, ...request});
        return {'id': request['id'], 'result': <String, Object?>{}};
      },
    );

    await callGetSelected(server);

    expect(calls.single['endpoint'], '/run/fallback.sock');
  });

  test('notifications do not produce a response', () async {
    final server = PickforgeMcpServer(projectRoot: Directory.current.path);

    final response = await server.handleLine(
      jsonEncode({'jsonrpc': '2.0', 'method': 'notifications/initialized'}),
    );

    expect(response, isNull);
  });
}

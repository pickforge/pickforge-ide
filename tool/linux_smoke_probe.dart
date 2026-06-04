import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

Future<void> main(List<String> args) async {
  if (args.length != 2) {
    stderr.writeln(
      'Usage: fvm dart run tool/linux_smoke_probe.dart <ws-url> <out.json>',
    );
    exitCode = 64;
    return;
  }

  final service = await vmServiceConnectUri(args[0]);
  try {
    final vm = await service.getVM();
    final isolateId =
        vm.isolates?.where((isolate) => isolate.id != null).firstOrNull?.id;
    if (isolateId == null) {
      stderr.writeln('No runnable isolate found.');
      exitCode = 1;
      return;
    }

    final rootTree = await _retryInspectorRoot(service, isolateId);
    if (rootTree == null) {
      stderr.writeln('Flutter inspector root tree was unavailable.');
      exitCode = 1;
      return;
    }

    final encodedTree = const JsonEncoder.withIndent('  ').convert(rootTree);
    if (!encodedTree.contains('DemoWorkspaceView')) {
      stderr.writeln('Smoke route did not reach DemoWorkspaceView.');
      exitCode = 1;
      return;
    }

    final out = File(args[1]);
    await out.parent.create(recursive: true);
    await out.writeAsString(encodedTree);
  } finally {
    await service.dispose();
  }
}

Future<Map<String, dynamic>?> _retryInspectorRoot(
  VmService service,
  String isolateId,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 30));
  while (DateTime.now().isBefore(deadline)) {
    try {
      final response = await service.callServiceExtension(
        'ext.flutter.inspector.getRootWidgetSummaryTree',
        isolateId: isolateId,
        args: const {'objectGroup': 'pickforge-smoke'},
      );
      final json = response.json;
      final result = json?['result'];
      if (result is Map<String, dynamic>) return result;
      if (result is Map) return Map<String, dynamic>.from(result);
      if (json != null) return json;
    } on RPCError catch (error) {
      if (!_isRetryable(error)) rethrow;
    }
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
  return null;
}

bool _isRetryable(RPCError error) {
  return error.code == RPCErrorKind.kMethodNotFound.code ||
      error.code == RPCErrorKind.kServiceDisappeared.code ||
      error.code == RPCErrorKind.kServerError.code;
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

Future<void> main(List<String> args) async {
  final parsed = _Args.parse(args);
  if (parsed == null) {
    stderr.writeln(
      'Usage: fvm dart run tool/visible_diagnostics_probe.dart '
      '<ws-url> <out.json> [--expect <text>] [--reject <text>]',
    );
    exitCode = 64;
    return;
  }

  final service = await vmServiceConnectUri(parsed.vmServiceUrl);
  try {
    final vm = await service.getVM();
    final isolateId =
        vm.isolates?.where((isolate) => isolate.id != null).firstOrNull?.id;
    if (isolateId == null) {
      stderr.writeln('No runnable isolate found.');
      exitCode = 1;
      return;
    }

    final result = await _retryInspectorRoot(service, isolateId, parsed);
    if (result == null) {
      stderr.writeln('Flutter inspector root tree did not match.');
      exitCode = 1;
      return;
    }
    final out = File(parsed.outputPath);
    await out.parent.create(recursive: true);
    await out.writeAsString(result.encodedTree);
  } finally {
    await service.dispose();
  }
}

Future<_ProbeResult?> _retryInspectorRoot(
  VmService service,
  String isolateId,
  _Args args,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  var lastFailures = <String>['Flutter inspector root tree was unavailable.'];
  String? lastTree;
  while (DateTime.now().isBefore(deadline)) {
    try {
      final root = await _inspectorRoot(service, isolateId);
      if (root != null) {
        final encodedTree = const JsonEncoder.withIndent('  ').convert(root);
        lastTree = encodedTree;
        final failures = _failures(encodedTree, args);
        if (failures.isEmpty) return _ProbeResult(encodedTree);
        lastFailures = failures;
      }
    } on RPCError catch (error) {
      if (!_isRetryable(error)) rethrow;
    }
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
  if (lastTree != null) stdout.write(lastTree);
  lastFailures.forEach(stderr.writeln);
  return null;
}

Future<Map<String, dynamic>?> _inspectorRoot(
  VmService service,
  String isolateId,
) async {
  final response = await service.callServiceExtension(
    'ext.flutter.inspector.getRootWidgetSummaryTree',
    isolateId: isolateId,
    args: const {'objectGroup': 'pickforge-visible-diagnostics-smoke'},
  );
  final json = response.json;
  final result = json?['result'];
  if (result is Map<String, dynamic>) return result;
  if (result is Map) return Map<String, dynamic>.from(result);
  return json;
}

List<String> _failures(String encodedTree, _Args args) => [
      for (final expected in args.expected)
        if (!encodedTree.contains(expected)) 'Missing expected text: $expected',
      for (final rejected in args.rejected)
        if (encodedTree.contains(rejected)) 'Found rejected text: $rejected',
    ];

bool _isRetryable(RPCError error) {
  return error.code == RPCErrorKind.kMethodNotFound.code ||
      error.code == RPCErrorKind.kServiceDisappeared.code ||
      error.code == RPCErrorKind.kServerError.code;
}

class _ProbeResult {
  const _ProbeResult(this.encodedTree);

  final String encodedTree;
}

class _Args {
  const _Args({
    required this.vmServiceUrl,
    required this.outputPath,
    required this.expected,
    required this.rejected,
  });

  final String vmServiceUrl;
  final String outputPath;
  final List<String> expected;
  final List<String> rejected;

  static _Args? parse(List<String> args) {
    if (args.length < 2) return null;
    final expected = <String>[];
    final rejected = <String>[];
    for (var index = 2; index < args.length; index++) {
      final arg = args[index];
      switch (arg) {
        case '--expect':
          if (index + 1 >= args.length) return null;
          expected.add(args[++index]);
        case '--reject':
          if (index + 1 >= args.length) return null;
          rejected.add(args[++index]);
        default:
          return null;
      }
    }
    return _Args(
      vmServiceUrl: args[0],
      outputPath: args[1],
      expected: expected,
      rejected: rejected,
    );
  }
}

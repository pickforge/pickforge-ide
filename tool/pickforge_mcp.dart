import 'dart:io';

import 'package:pickforge/core/mcp/pickforge_mcp_server.dart';

Future<void> main(List<String> args) async {
  if (args.length > 1) {
    stderr.writeln('Usage: pickforge_mcp [project-root]');
    exitCode = 64;
    return;
  }

  final projectRoot = args.isEmpty ? Directory.current.path : args.single;
  await PickforgeMcpServer(projectRoot: projectRoot).serve(
    input: stdin,
    output: stdout,
  );
}

import 'dart:convert';
import 'dart:io';

import 'package:vm_service/vm_service_io.dart';

Future<void> main(List<String> args) async {
  if (args.length != 2) {
    stderr.writeln(
      'Usage: fvm dart run tool/record_vm_service.dart <ws-url> <out.jsonl>',
    );
    exitCode = 64;
    return;
  }

  final url = args[0];
  final outPath = args[1];
  final sink = File(outPath).openWrite();
  void record(Map<String, dynamic> entry) => sink.writeln(json.encode(entry));

  final service = await vmServiceConnectUri(url);
  final vm = await service.getVM();
  record({
    'type': 'response',
    'method': 'getVM',
    'result': {
      'type': 'VM',
      'name': vm.name,
      'isolates': vm.isolates
          ?.map((isolate) => {'id': isolate.id, 'name': isolate.name})
          .toList(),
    },
  });

  stdout.writeln('Recorded getVM. Press Ctrl-C to stop.');
  ProcessSignal.sigint.watch().listen((_) async {
    await sink.flush();
    await sink.close();
    await service.dispose();
    exit(0);
  });
}

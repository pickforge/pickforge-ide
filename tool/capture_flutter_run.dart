import 'dart:async';
import 'dart:convert';
import 'dart:io';

Future<void> main(List<String> args) async {
  if (args.length < 2) {
    stderr.writeln(
      'Usage: dart run tool/capture_flutter_run.dart <device-id> <sample-app-path> [output.jsonl]',
    );
    exitCode = 64;
    return;
  }

  final deviceId = args[0];
  final projectRoot = args[1];
  final outputPath = args.length > 2
      ? args[2]
      : 'test/fixtures/flutter_run_machine_captured.jsonl';
  final output = File(outputPath);
  await output.parent.create(recursive: true);

  final process = await Process.start(
    'flutter',
    ['run', '--machine', '-d', deviceId],
    workingDirectory: projectRoot,
  );
  final sink = output.openWrite();
  final subscriptions = <StreamSubscription<String>>[];
  subscriptions.add(
    process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => sink.writeln(_anonymize(line, projectRoot))),
  );
  subscriptions.add(
    process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => sink.writeln(_anonymize(line, projectRoot))),
  );

  stdout
      .writeln('Capturing flutter run --machine. Press q then Enter to stop.');
  await stdin
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .firstWhere((line) => line.trim().toLowerCase() == 'q');
  process.stdin.writeln('q');
  await process.stdin.close();
  await process.exitCode;
  for (final sub in subscriptions) {
    await sub.cancel();
  }
  await sink.close();
}

String _anonymize(String line, String projectRoot) {
  return line
      .replaceAll(projectRoot, '<PROJECT>')
      .replaceAll(RegExp(r'[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}'), '<UUID>')
      .replaceAll(RegExp(r'file://[^"\s]+'), 'file://<PATH>');
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:logging/logging.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/logging/app_logging.dart';
import 'package:pickforge/core/logging/log_file_writer.dart';
import 'package:pickforge/core/logging/log_settings.dart';

class _MockProcessRunner extends Mock implements ProcessRunner {}

void main() {
  late Directory tmp;
  late DiagnosticsService diagnostics;
  late AppLogging logging;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_app_logging');
    diagnostics = DiagnosticsService(_MockProcessRunner());
    logging = AppLogging(
      writer: LogFileWriter(directory: tmp),
      diagnostics: diagnostics,
    );
    await logging.start();
  });

  tearDown(() async {
    await logging.dispose();
    Logger.root.level = Level.INFO;
    await tmp.delete(recursive: true);
  });

  Future<String> fileContent() async {
    await logging.flush();
    return logging.writer.currentFile!.readAsString();
  }

  test('start writes the launch banner', () async {
    expect(await fileContent(), contains('[app] PickForge'));
  });

  test('logger records land in the file and the diagnostics ring', () async {
    Logger('pty.session').info('spawned zsh');

    expect(await fileContent(), contains('[info] [pty.session] spawned zsh'));
    expect(
      diagnostics.logs.map((e) => e.message),
      contains('[pty.session] spawned zsh'),
    );
  });

  test('severe records carry error and stack and flush urgently', () async {
    Logger('app.error').severe('it broke', StateError('bad'));

    // No explicit flush: WARNING+ is urgent.
    await Future<void>.delayed(Duration.zero);
    final content = await logging.writer.currentFile!.readAsString();
    expect(content, contains('[error] [app.error] it broke'));
    expect(content, contains('Bad state: bad'));
  });

  test('lines are redacted before they reach the file', () async {
    Logger('app').info('token=sk-ant-api03-supersecretvalue1234567890');

    final content = await fileContent();
    expect(content, isNot(contains('supersecretvalue')));
  });

  test('legacy DiagnosticsService.recordLog reaches the file too', () async {
    diagnostics.recordLog('info', 'legacy entry');

    expect(await fileContent(), contains('[info] legacy entry'));
  });

  test('verbosity gates fine records', () async {
    Logger('app').fine('hidden tracing');
    expect(await fileContent(), isNot(contains('hidden tracing')));

    logging.setVerbosity(LogVerbosity.verbose);
    Logger('app').fine('visible tracing');
    expect(await fileContent(), contains('[debug] [app] visible tracing'));
  });
}

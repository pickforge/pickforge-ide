import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/run_session_event_log_writer.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

void main() {
  void markProjectLocal(Directory project) {
    Directory(p.join(project.path, '.pickforge')).createSync(recursive: true);
    File(p.join(project.path, '.pickforge', '.gitignore'))
        .writeAsStringSync('*\n');
  }

  test('appends run session events as JSONL under .pickforge/runs', () async {
    final project = await Directory.systemTemp.createTemp('pickforge_run_log_');
    addTearDown(() => project.delete(recursive: true));
    final home = await Directory.systemTemp.createTemp('pickforge_run_home_');
    addTearDown(() => home.delete(recursive: true));
    markProjectLocal(project);

    final writer = RunSessionEventLogWriter(
      ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': home.path},
      ),
    );
    await writer.append(
      projectRoot: project.path,
      sessionId: 'session-1',
      event: const RunSessionEvent.stage(message: 'Building...'),
      timestamp: DateTime.utc(2026, 6, 3, 12),
    );
    await writer.append(
      projectRoot: project.path,
      sessionId: 'session-1',
      event: const RunSessionEvent.log(
        line: 'compile failed',
        level: LogLevel.error,
      ),
      timestamp: DateTime.utc(2026, 6, 3, 12, 0, 1),
    );
    await writer.append(
      projectRoot: project.path,
      sessionId: 'session-1',
      event: const RunSessionEvent.vmServiceReady(uri: 'ws://x/ws'),
      timestamp: DateTime.utc(2026, 6, 3, 12, 0, 2),
    );
    await writer.append(
      projectRoot: project.path,
      sessionId: 'session-1',
      event: const RunSessionEvent.reloadCompleted(
        success: true,
        fullRestart: false,
        durationMs: 120,
        attribution: 'test',
        hint: 'ok',
      ),
      timestamp: DateTime.utc(2026, 6, 3, 12, 0, 3),
    );
    final logFile = await writer.append(
      projectRoot: project.path,
      sessionId: 'session-1',
      event: const RunSessionEvent.stopped(
        exitCode: 0,
        reason: 'user_stop',
      ),
      timestamp: DateTime.utc(2026, 6, 3, 12, 0, 4),
    );

    expect(
      logFile.path,
      p.join(project.path, '.pickforge', 'runs', 'session-1', 'log.jsonl'),
    );
    expect(
      File(p.join(project.path, '.pickforge', '.gitignore')).readAsStringSync(),
      '*\n',
    );

    final lines = logFile.readAsLinesSync();
    expect(lines, hasLength(5));

    final records = [
      for (final line in lines) jsonDecode(line) as Map<String, dynamic>,
    ];
    expect(records.map((record) => record['type']), [
      'stage',
      'log',
      'vmServiceReady',
      'reloadCompleted',
      'stopped',
    ]);
    expect(records[0]['message'], 'Building...');
    expect(records[1]['level'], 'error');
    expect(records[2]['uri'], 'ws://x/ws');
    expect(records[3]['hint'], 'ok');
    expect(records[4]['reason'], 'user_stop');
  });

  test('parity: project-local marker pins legacy <root>/.pickforge/runs path',
      () async {
    final project = await Directory.systemTemp.createTemp('pickforge_run_log_');
    addTearDown(() => project.delete(recursive: true));
    final home = await Directory.systemTemp.createTemp('pickforge_run_home_');
    addTearDown(() => home.delete(recursive: true));
    markProjectLocal(project);

    final writer = RunSessionEventLogWriter(
      ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': home.path},
      ),
    );
    final logFile = await writer.append(
      projectRoot: project.path,
      sessionId: 'session-x',
      event: const RunSessionEvent.stage(message: 'go'),
      timestamp: DateTime.utc(2026, 6, 3, 12),
    );

    expect(
      logFile.path,
      p.join(project.path, '.pickforge', 'runs', 'session-x', 'log.jsonl'),
    );
  });

  test('home mode: clean project writes under <home>/projects/<id>/runs',
      () async {
    final project = await Directory.systemTemp.createTemp('pickforge_run_log_');
    addTearDown(() => project.delete(recursive: true));
    final home = await Directory.systemTemp.createTemp('pickforge_run_home_');
    addTearDown(() => home.delete(recursive: true));

    final writer = RunSessionEventLogWriter(
      ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': home.path},
      ),
    );
    final logFile = await writer.append(
      projectRoot: project.path,
      sessionId: 'session-h',
      event: const RunSessionEvent.stage(message: 'go'),
      timestamp: DateTime.utc(2026, 6, 3, 12),
    );

    expect(Directory(p.join(project.path, '.pickforge')).existsSync(), isFalse);
    final projects = Directory(p.join(home.path, 'projects'));
    final projectDir = projects.listSync().whereType<Directory>().single;
    expect(
      logFile.path,
      p.join(projectDir.path, 'runs', 'session-h', 'log.jsonl'),
    );
  });
}

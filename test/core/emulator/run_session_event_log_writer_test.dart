import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/run_session_event_log_writer.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

void main() {
  test('appends run session events as JSONL under .pickforge/runs', () async {
    final project = await Directory.systemTemp.createTemp('pickforge_run_log_');
    addTearDown(() => project.delete(recursive: true));

    const writer = RunSessionEventLogWriter();
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
}

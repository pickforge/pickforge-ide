import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/core/projects/pickforge_project_directory.dart';

class RunSessionEventLogWriter {
  const RunSessionEventLogWriter();

  Future<File> append({
    required String projectRoot,
    required String sessionId,
    required RunSessionEvent event,
    DateTime? timestamp,
  }) async {
    final pickforgeDir = await PickforgeProjectDirectory.ensure(projectRoot);
    final runDir = Directory(p.join(pickforgeDir.path, 'runs', sessionId));
    await runDir.create(recursive: true);
    final file = File(p.join(runDir.path, 'log.jsonl'));
    final line = jsonEncode({
      'timestamp': (timestamp ?? DateTime.now().toUtc()).toIso8601String(),
      ..._eventJson(event),
    });
    await file.writeAsString('$line\n', mode: FileMode.append, flush: true);
    return file;
  }

  Map<String, Object?> _eventJson(RunSessionEvent event) {
    return event.when(
      stage: (message) => {
        'type': 'stage',
        'message': message,
      },
      log: (line, level, source) => {
        'type': 'log',
        'line': line,
        'level': level.name,
        'source': source,
      },
      vmServiceReady: (uri) => {
        'type': 'vmServiceReady',
        'uri': uri,
      },
      stopped: (exitCode, reason) => {
        'type': 'stopped',
        'exitCode': exitCode,
        'reason': reason,
      },
      reloadCompleted: (success, fullRestart, durationMs, attribution, hint) =>
          {
        'type': 'reloadCompleted',
        'success': success,
        'fullRestart': fullRestart,
        'durationMs': durationMs,
        'attribution': attribution,
        if (hint != null) 'hint': hint,
      },
    );
  }
}

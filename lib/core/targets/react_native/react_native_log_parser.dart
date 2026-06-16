import 'dart:convert';

import 'package:pickforge/core/emulator/run_session_models.dart';

/// Turns Metro output lines into PickForge [RunSessionEvent]s so a React Native
/// run streams through the same run-log model as Flutter.
///
/// The level heuristic is intentionally simple and line-based: the RN CLI
/// prefixes severity (`info`/`warn`/`error`), so a leading keyword classifies
/// the line. (logcat parsing is layered on in a later slice.)
class ReactNativeLogParser {
  const ReactNativeLogParser();

  /// Parses a whole Metro output chunk into events (blank lines dropped).
  List<RunSessionEvent> parseMetro(String chunk) => const LineSplitter()
      .convert(chunk)
      .map(metroEvent)
      .whereType<RunSessionEvent>()
      .toList();

  /// Parses a single Metro output line, or `null` when blank.
  RunSessionEvent? metroEvent(String line) {
    if (line.trim().isEmpty) return null;
    return RunSessionEvent.log(
      line: line.trimRight(),
      level: _metroLevel(line),
      source: 'metro',
    );
  }

  LogLevel _metroLevel(String line) {
    final token = line.trimLeft().toLowerCase();
    if (token.startsWith('error') ||
        token.startsWith('fatal') ||
        token.contains('error:')) {
      return LogLevel.error;
    }
    if (token.startsWith('warn')) return LogLevel.warning;
    return LogLevel.info;
  }
}

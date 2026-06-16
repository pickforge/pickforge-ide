import 'dart:convert';

import 'package:pickforge/core/emulator/run_session_models.dart';

/// Turns Metro and logcat output lines into PickForge [RunSessionEvent]s so a
/// React Native run streams through the same run-log model as Flutter.
///
/// The level heuristics are intentionally simple and line-based: the RN CLI
/// prefixes severity (`info`/`warn`/`error`) and logcat carries a priority
/// letter (`V`/`D`/`I`/`W`/`E`/`F`).
class ReactNativeLogParser {
  const ReactNativeLogParser();

  static final _logcatThreadTime = RegExp(
    r'^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s',
  );
  static final _logcatBrief = RegExp('^([VDIWEF])/');

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

  /// Parses a single `adb logcat` line, or `null` when blank.
  RunSessionEvent? logcatEvent(String line) {
    if (line.trim().isEmpty) return null;
    return RunSessionEvent.log(
      line: line.trimRight(),
      level: _logcatLevel(line),
      source: 'logcat',
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

  LogLevel _logcatLevel(String line) {
    final priority =
        (_logcatThreadTime.firstMatch(line) ?? _logcatBrief.firstMatch(line))
            ?.group(1);
    switch (priority) {
      case 'E':
      case 'F':
        return LogLevel.error;
      case 'W':
        return LogLevel.warning;
      default:
        return LogLevel.info;
    }
  }
}

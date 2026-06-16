import 'dart:convert';

import 'package:pickforge/core/android/android_logcat_parser.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';

/// Turns Metro and logcat output lines into PickForge [RunSessionEvent]s so a
/// React Native run streams through the same run-log model as Flutter.
///
/// Metro level heuristics live here (the RN CLI prefixes `info`/`warn`/`error`);
/// logcat parsing delegates to the shared [AndroidLogcatParser].
class ReactNativeLogParser {
  const ReactNativeLogParser();

  static const _logcat = AndroidLogcatParser();

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
  RunSessionEvent? logcatEvent(String line) => _logcat.logcatEvent(line);

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

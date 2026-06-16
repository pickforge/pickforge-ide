import 'package:pickforge/core/emulator/run_session_models.dart';

/// Turns `adb logcat` lines into PickForge [RunSessionEvent]s, shared by every
/// Android-backed target.
///
/// The level heuristic reads the logcat priority letter (`V`/`D`/`I`/`W`/`E`/
/// `F`) from the threadtime or brief formats; `E`/`F` → error, `W` → warning,
/// everything else → info.
class AndroidLogcatParser {
  const AndroidLogcatParser();

  static final _threadTime = RegExp(
    r'^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s',
  );
  static final _brief = RegExp('^([VDIWEF])/');

  /// Parses a single `adb logcat` line, or `null` when blank.
  RunSessionEvent? logcatEvent(String line) {
    if (line.trim().isEmpty) return null;
    return RunSessionEvent.log(
      line: line.trimRight(),
      level: _level(line),
      source: 'logcat',
    );
  }

  LogLevel _level(String line) {
    final priority =
        (_threadTime.firstMatch(line) ?? _brief.firstMatch(line))?.group(1);
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

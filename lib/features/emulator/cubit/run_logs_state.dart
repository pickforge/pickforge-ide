import 'package:pickforge/core/emulator/run_session_models.dart';

enum LogFilter { all, build, hotReload, errors }

class RunLogEntry {
  const RunLogEntry({
    required this.timestamp,
    required this.line,
    required this.level,
    required this.category,
  });

  final DateTime timestamp;
  final String line;
  final LogLevel level;
  final String category;
}

class RunLogsState {
  const RunLogsState({
    this.entries = const [],
    this.filter = LogFilter.all,
  });

  final List<RunLogEntry> entries;
  final LogFilter filter;

  List<RunLogEntry> get visibleEntries => switch (filter) {
        LogFilter.all => entries,
        LogFilter.build => entries.where((e) => e.category == 'build').toList(),
        LogFilter.hotReload =>
          entries.where((e) => e.category == 'hot').toList(),
        LogFilter.errors =>
          entries.where((e) => e.level == LogLevel.error).toList(),
      };

  RunLogsState copyWith({
    List<RunLogEntry>? entries,
    LogFilter? filter,
  }) =>
      RunLogsState(
        entries: entries ?? this.entries,
        filter: filter ?? this.filter,
      );
}

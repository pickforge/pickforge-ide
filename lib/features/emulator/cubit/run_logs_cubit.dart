import 'package:bloc/bloc.dart';
import 'package:pickforge/core/emulator/run_session_models.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_state.dart';

class RunLogsCubit extends Cubit<RunLogsState> {
  RunLogsCubit({this.cap = 5000}) : super(const RunLogsState());

  final int cap;

  void append(RunSessionEvent event) {
    final entry = event.maybeMap(
      stage: (event) => _entry(event.message, LogLevel.info, 'build'),
      log: (event) => _entry(
        event.line,
        event.level,
        event.level == LogLevel.error ? 'err' : 'log',
      ),
      vmServiceReady: (event) => _entry(
        'VM service: ${event.uri}',
        LogLevel.info,
        'vm',
      ),
      reloadCompleted: (event) => _entry(
        '[${event.attribution}] ${event.fullRestart ? 'restart' : 'reload'} '
            '${event.success ? 'ok' : 'failed'} ${event.durationMs}ms',
        event.success ? LogLevel.info : LogLevel.error,
        'hot',
      ),
      stopped: (event) => _entry(
        'Stopped (${event.reason}, code=${event.exitCode})',
        LogLevel.info,
        'log',
      ),
      orElse: () => null,
    );
    if (entry == null) return;
    final next = [...state.entries, entry];
    if (next.length > cap) {
      next.removeRange(0, next.length - cap);
    }
    emit(state.copyWith(entries: next));
  }

  void setFilter(LogFilter filter) => emit(state.copyWith(filter: filter));

  void clear() => emit(state.copyWith(entries: const []));

  RunLogEntry _entry(String line, LogLevel level, String category) =>
      RunLogEntry(
        timestamp: DateTime.now(),
        line: line,
        level: level,
        category: category,
      );
}

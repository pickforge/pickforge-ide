import 'package:freezed_annotation/freezed_annotation.dart';

part 'run_session_models.freezed.dart';

enum LogLevel { info, warning, error, status }

@freezed
abstract class RunSessionEvent with _$RunSessionEvent {
  const factory RunSessionEvent.stage({required String message}) = _Stage;

  const factory RunSessionEvent.log({
    required String line,
    required LogLevel level,
    @Default('flutter') String source,
  }) = _Log;

  const factory RunSessionEvent.vmServiceReady({required String uri}) =
      _VmReady;

  const factory RunSessionEvent.stopped({
    required int exitCode,
    required String reason,
  }) = _Stopped;

  const factory RunSessionEvent.reloadCompleted({
    required bool success,
    required bool fullRestart,
    required int durationMs,
    @Default('user') String attribution,
    String? hint,
  }) = _ReloadCompleted;
}

class RunStats {
  RunStats({
    DateTime? startedAt,
    this.hotReloadCount = 0,
    this.hotRestartCount = 0,
  }) : startedAt = startedAt ?? DateTime.now();

  final DateTime startedAt;
  int hotReloadCount;
  int hotRestartCount;

  RunStats copyWith({int? hotReloadCount, int? hotRestartCount}) => RunStats(
        startedAt: startedAt,
        hotReloadCount: hotReloadCount ?? this.hotReloadCount,
        hotRestartCount: hotRestartCount ?? this.hotRestartCount,
      );
}

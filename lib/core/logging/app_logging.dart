import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/logging/log_file_writer.dart';
import 'package:pickforge/core/logging/log_settings.dart';

/// Wires `package:logging` to the run-log file and the diagnostics ring
/// buffer.
///
/// Call sites emit through hierarchical loggers (`Logger('pty.session')`,
/// `Logger('projects')`); there is exactly one record path:
///
///   Logger -> [_handleRecord] -> DiagnosticsService.recordLog
///          -> ring buffer + redacted line -> LogFileWriter
///
/// Legacy `DiagnosticsService.recordLog` call sites reach the file through
/// the same forwarding hook, so the run log is complete either way and the
/// redactor runs exactly once per line.
class AppLogging {
  AppLogging({
    required this.writer,
    required this.diagnostics,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final LogFileWriter writer;
  final DiagnosticsService diagnostics;
  final DateTime Function() _now;

  StreamSubscription<LogRecord>? _subscription;

  Future<void> start({LogVerbosity verbosity = LogVerbosity.normal}) async {
    await writer.open();
    setVerbosity(verbosity);
    diagnostics.onRecord = _writeToFile;
    _subscription ??= Logger.root.onRecord.listen(_handleRecord);
    Logger('app').info(
      'PickForge ${diagnostics.appVersion} started '
      '(${Platform.operatingSystem}'
      '${_commitSuffix(diagnostics.buildMetadata.commitSha)})',
    );
  }

  void setVerbosity(LogVerbosity verbosity) {
    Logger.root.level = switch (verbosity) {
      LogVerbosity.normal => Level.INFO,
      LogVerbosity.verbose => Level.FINE,
    };
  }

  /// Routes uncaught framework and platform errors into the log. Install
  /// BEFORE more specific handlers (e.g. the keyboard-assertion guard in
  /// main.dart): later-installed handlers run first and delegate to this
  /// one, so deliberately swallowed errors never reach the log.
  void installErrorHooks() {
    final previousFlutter = FlutterError.onError;
    final previousPlatform = PlatformDispatcher.instance.onError;
    FlutterError.onError = (details) {
      Logger('app.error').severe(
        details.exceptionAsString(),
        details.exception,
        details.stack,
      );
      (previousFlutter ?? FlutterError.presentError)(details);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      Logger('app.error').severe('Uncaught: $error', error, stack);
      return previousPlatform?.call(error, stack) ?? false;
    };
  }

  Future<String> tail({int maxLines = 200}) => writer.tail(maxLines: maxLines);

  Future<void> flush() => writer.flush();

  /// Where the run logs live — surfaced by Settings ("Open logs folder").
  Directory get logsDirectory => writer.directory;

  Future<void> dispose() async {
    Logger('app').info('PickForge shutting down');
    await _subscription?.cancel();
    _subscription = null;
    diagnostics.onRecord = null;
    await writer.close();
  }

  void _handleRecord(LogRecord record) {
    final buffer = StringBuffer('[${record.loggerName}] ${record.message}');
    if (record.error != null) buffer.write(' — ${record.error}');
    if (record.stackTrace != null) buffer.write('\n${record.stackTrace}');
    // recordLog redacts, keeps the ring buffer, and forwards the redacted
    // line back to [_writeToFile].
    diagnostics.recordLog(_levelName(record.level), buffer.toString());
  }

  void _writeToFile(String level, String message) {
    final urgent = level == 'error' || level == 'warning';
    writer.writeLine(
      '${_now().toUtc().toIso8601String()} [$level] $message',
      urgent: urgent,
    );
  }

  String _levelName(Level level) {
    if (level >= Level.SEVERE) return 'error';
    if (level >= Level.WARNING) return 'warning';
    if (level >= Level.INFO) return 'info';
    return 'debug';
  }

  String _commitSuffix(String? sha) => sha == null
      ? ''
      : ', build ${sha.length > 9 ? sha.substring(0, 9) : sha}';
}

import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/agent/context_redactor.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

const _defaultAppVersion = String.fromEnvironment(
  'PICKFORGE_VERSION',
  defaultValue: '0.1.0+1',
);

class DiagnosticsSnapshot extends Equatable {
  const DiagnosticsSnapshot({
    required this.appVersion,
    required this.operatingSystem,
    required this.adbAvailable,
    required this.gitAvailable,
    required this.flutterAvailable,
    required this.flutterVersion,
    required this.emulatorAvailable,
    required this.claudeAvailable,
    required this.codexAvailable,
    required this.openCodeAvailable,
    required this.cursorAvailable,
    required this.geminiAvailable,
    required this.lastVmError,
  });

  final String appVersion;
  final String operatingSystem;
  final bool adbAvailable;
  final bool gitAvailable;
  final bool flutterAvailable;
  final String? flutterVersion;
  final bool emulatorAvailable;
  final bool claudeAvailable;
  final bool codexAvailable;
  final bool openCodeAvailable;
  final bool cursorAvailable;
  final bool geminiAvailable;
  final String? lastVmError;

  @override
  List<Object?> get props => [
        appVersion,
        operatingSystem,
        adbAvailable,
        gitAvailable,
        flutterAvailable,
        flutterVersion,
        emulatorAvailable,
        claudeAvailable,
        codexAvailable,
        openCodeAvailable,
        cursorAvailable,
        geminiAvailable,
        lastVmError,
      ];
}

class DiagnosticsService {
  DiagnosticsService(
    this._runner, {
    ContextRedactor redactor = const ContextRedactor(),
    int maxLogEntries = 100,
    String appVersion = _defaultAppVersion,
  })  : _redactor = redactor,
        _maxLogEntries = maxLogEntries,
        _appVersion = appVersion;

  final ProcessRunner _runner;
  final ContextRedactor _redactor;
  final int _maxLogEntries;
  final String _appVersion;
  final List<DiagnosticsLogEntry> _logs = [];
  String? _lastVmError;

  Future<DiagnosticsSnapshot> snapshot() async {
    final flutter = await _commandStatus('fvm', ['flutter', '--version']);
    return DiagnosticsSnapshot(
      appVersion: _appVersion,
      operatingSystem: Platform.operatingSystem,
      adbAvailable: await _commandAvailable('adb', ['version']),
      gitAvailable: await _commandAvailable('git', ['--version']),
      flutterAvailable: flutter.available,
      flutterVersion: flutter.available
          ? _firstOutputLine(flutter.output) ?? 'available'
          : null,
      emulatorAvailable: await _commandAvailable('emulator', ['-version']),
      claudeAvailable: await _commandAvailable('claude', ['--version']),
      codexAvailable: await _commandAvailable('codex', ['--version']),
      openCodeAvailable: await _commandAvailable('opencode', ['--version']),
      cursorAvailable: await _commandAvailable('agent', ['--version']),
      geminiAvailable: await _commandAvailable('gemini', ['--version']),
      lastVmError: _lastVmError,
    );
  }

  List<DiagnosticsLogEntry> get logs => List.unmodifiable(_logs);
  String? get lastVmError => _lastVmError;

  void recordLog(String level, String message) {
    _logs.add(
      DiagnosticsLogEntry(
        timestamp: DateTime.now().toUtc(),
        level: level,
        message: _redactor.redact(message),
      ),
    );
    if (_logs.length > _maxLogEntries) {
      _logs.removeRange(0, _logs.length - _maxLogEntries);
    }
  }

  void recordVmError(String message) {
    final redacted = _redactor.redact(message);
    _lastVmError = redacted;
    recordLog('error', 'VM Service: $redacted');
  }

  Future<String> buildSupportBundle({
    String? activeProjectRoot,
    String? lastVmError,
  }) async {
    final current = await snapshot();
    final vmError = _nonEmpty(lastVmError) ?? _nonEmpty(current.lastVmError);
    final buffer = StringBuffer()
      ..writeln('# Pickforge Support Bundle')
      ..writeln()
      ..writeln('Source files, prompts, screenshots, and secrets: excluded')
      ..writeln()
      ..writeln('## Environment')
      ..writeln()
      ..writeln('- App version: ${current.appVersion}')
      ..writeln('- OS: ${current.operatingSystem}')
      ..writeln('- Project: ${_projectLabel(activeProjectRoot)}')
      ..writeln('- adb: ${_availability(current.adbAvailable)}')
      ..writeln('- git: ${_availability(current.gitAvailable)}')
      ..writeln(
        '- Flutter/FVM: ${current.flutterVersion ?? _availability(false)}',
      )
      ..writeln('- emulator: ${_availability(current.emulatorAvailable)}')
      ..writeln('- Claude Code: ${_availability(current.claudeAvailable)}')
      ..writeln('- Codex: ${_availability(current.codexAvailable)}')
      ..writeln('- OpenCode: ${_availability(current.openCodeAvailable)}')
      ..writeln('- Cursor: ${_availability(current.cursorAvailable)}')
      ..writeln('- Gemini: ${_availability(current.geminiAvailable)}');

    if (vmError != null) {
      buffer
        ..writeln()
        ..writeln('## Last VM error')
        ..writeln()
        ..writeln(_redactor.redact(vmError));
    }

    buffer
      ..writeln()
      ..writeln('## Recent app log')
      ..writeln();
    if (_logs.isEmpty) {
      buffer.writeln('No local diagnostics log entries recorded.');
    } else {
      for (final entry in _logs) {
        buffer.writeln(
          '- ${entry.timestamp.toIso8601String()} '
          '[${entry.level}] ${entry.message}',
        );
      }
    }
    return buffer.toString();
  }

  Future<bool> _commandAvailable(String executable, List<String> args) async {
    final result = await _commandStatus(executable, args);
    return result.available;
  }

  Future<_CommandStatus> _commandStatus(
    String executable,
    List<String> args,
  ) async {
    try {
      final result = await _runner.run(executable, args);
      return _CommandStatus(
        available: result.exitCode == 0,
        output: '${result.stdout}',
      );
    } on ProcessRunnerException {
      return const _CommandStatus(available: false);
    }
  }

  String? _firstOutputLine(String? output) {
    final value = output?.trim();
    if (value == null || value.isEmpty) return null;
    return value.split('\n').first.trim();
  }

  String? _nonEmpty(String? value) {
    final trimmed = value?.trim();
    return trimmed == null || trimmed.isEmpty ? null : trimmed;
  }

  String _projectLabel(String? activeProjectRoot) {
    if (activeProjectRoot == null || activeProjectRoot.trim().isEmpty) {
      return 'none';
    }
    return activeProjectRoot.split(Platform.pathSeparator).last;
  }

  String _availability(bool value) => value ? 'available' : 'missing';
}

class _CommandStatus {
  const _CommandStatus({required this.available, this.output});

  final bool available;
  final String? output;
}

class DiagnosticsLogEntry extends Equatable {
  const DiagnosticsLogEntry({
    required this.timestamp,
    required this.level,
    required this.message,
  });

  final DateTime timestamp;
  final String level;
  final String message;

  @override
  List<Object?> get props => [timestamp, level, message];
}

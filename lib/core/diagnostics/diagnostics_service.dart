import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:pickforge/core/agent/context_redactor.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

class DiagnosticsSnapshot extends Equatable {
  const DiagnosticsSnapshot({
    required this.operatingSystem,
    required this.adbAvailable,
    required this.gitAvailable,
    required this.flutterAvailable,
    required this.emulatorAvailable,
    required this.claudeAvailable,
    required this.codexAvailable,
    required this.openCodeAvailable,
    required this.cursorAvailable,
    required this.geminiAvailable,
  });

  final String operatingSystem;
  final bool adbAvailable;
  final bool gitAvailable;
  final bool flutterAvailable;
  final bool emulatorAvailable;
  final bool claudeAvailable;
  final bool codexAvailable;
  final bool openCodeAvailable;
  final bool cursorAvailable;
  final bool geminiAvailable;

  @override
  List<Object?> get props => [
        operatingSystem,
        adbAvailable,
        gitAvailable,
        flutterAvailable,
        emulatorAvailable,
        claudeAvailable,
        codexAvailable,
        openCodeAvailable,
        cursorAvailable,
        geminiAvailable,
      ];
}

class DiagnosticsService {
  DiagnosticsService(
    this._runner, {
    ContextRedactor redactor = const ContextRedactor(),
    int maxLogEntries = 100,
  })  : _redactor = redactor,
        _maxLogEntries = maxLogEntries;

  final ProcessRunner _runner;
  final ContextRedactor _redactor;
  final int _maxLogEntries;
  final List<DiagnosticsLogEntry> _logs = [];

  Future<DiagnosticsSnapshot> snapshot() async {
    return DiagnosticsSnapshot(
      operatingSystem: Platform.operatingSystem,
      adbAvailable: await _commandAvailable('adb', ['version']),
      gitAvailable: await _commandAvailable('git', ['--version']),
      flutterAvailable:
          await _commandAvailable('fvm', ['flutter', '--version']),
      emulatorAvailable: await _commandAvailable('emulator', ['-version']),
      claudeAvailable: await _commandAvailable('claude', ['--version']),
      codexAvailable: await _commandAvailable('codex', ['--version']),
      openCodeAvailable: await _commandAvailable('opencode', ['--version']),
      cursorAvailable: await _commandAvailable('agent', ['--version']),
      geminiAvailable: await _commandAvailable('gemini', ['--version']),
    );
  }

  List<DiagnosticsLogEntry> get logs => List.unmodifiable(_logs);

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

  Future<String> buildSupportBundle({
    String? activeProjectRoot,
    String? lastVmError,
  }) async {
    final current = await snapshot();
    final buffer = StringBuffer()
      ..writeln('# Pickforge Support Bundle')
      ..writeln()
      ..writeln('Source files, prompts, screenshots, and secrets: excluded')
      ..writeln()
      ..writeln('## Environment')
      ..writeln()
      ..writeln('- OS: ${current.operatingSystem}')
      ..writeln('- Project: ${_projectLabel(activeProjectRoot)}')
      ..writeln('- adb: ${_availability(current.adbAvailable)}')
      ..writeln('- git: ${_availability(current.gitAvailable)}')
      ..writeln('- Flutter/FVM: ${_availability(current.flutterAvailable)}')
      ..writeln('- emulator: ${_availability(current.emulatorAvailable)}')
      ..writeln('- Claude Code: ${_availability(current.claudeAvailable)}')
      ..writeln('- Codex: ${_availability(current.codexAvailable)}')
      ..writeln('- OpenCode: ${_availability(current.openCodeAvailable)}')
      ..writeln('- Cursor: ${_availability(current.cursorAvailable)}')
      ..writeln('- Gemini: ${_availability(current.geminiAvailable)}');

    if (lastVmError != null && lastVmError.trim().isNotEmpty) {
      buffer
        ..writeln()
        ..writeln('## Last VM error')
        ..writeln()
        ..writeln(_redactor.redact(lastVmError));
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
    try {
      final result = await _runner.run(executable, args);
      return result.exitCode == 0;
    } on ProcessRunnerException {
      return false;
    }
  }

  String _projectLabel(String? activeProjectRoot) {
    if (activeProjectRoot == null || activeProjectRoot.trim().isEmpty) {
      return 'none';
    }
    return activeProjectRoot.split(Platform.pathSeparator).last;
  }

  String _availability(bool value) => value ? 'available' : 'missing';
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

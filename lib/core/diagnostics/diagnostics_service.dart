import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/context_redactor.dart';
import 'package:pickforge/core/emulator/process_runner.dart';

const _defaultAppVersion = String.fromEnvironment(
  'PICKFORGE_VERSION',
  defaultValue: '0.1.0+1',
);
const _defaultBuildCommitSha = String.fromEnvironment(
  'PICKFORGE_BUILD_COMMIT',
);
const _defaultBuildRefName = String.fromEnvironment('PICKFORGE_BUILD_REF');
const _defaultBuildWorkflow = String.fromEnvironment(
  'PICKFORGE_BUILD_WORKFLOW',
);
const _defaultBuildRunId = String.fromEnvironment('PICKFORGE_BUILD_RUN_ID');
const _defaultBuildRunNumber = String.fromEnvironment(
  'PICKFORGE_BUILD_RUN_NUMBER',
);
const _defaultBuildUrl = String.fromEnvironment('PICKFORGE_BUILD_URL');

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
    required this.failures,
    required this.performanceCounters,
    required this.buildMetadata,
  });

  final String appVersion;
  final DiagnosticsBuildMetadata buildMetadata;
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
  final List<DiagnosticsFailureDetails> failures;
  final List<DiagnosticsPerformanceCounter> performanceCounters;

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
        failures,
        performanceCounters,
        buildMetadata,
      ];
}

class DiagnosticsBuildMetadata extends Equatable {
  const DiagnosticsBuildMetadata({
    this.commitSha,
    this.refName,
    this.workflow,
    this.runId,
    this.runNumber,
    this.buildUrl,
  });

  factory DiagnosticsBuildMetadata.fromEnvironment([
    Map<String, String>? environment,
  ]) {
    final env = environment ?? Platform.environment;
    return DiagnosticsBuildMetadata(
      commitSha: _firstNonEmpty([
        _defaultBuildCommitSha,
        env['PICKFORGE_BUILD_COMMIT'],
        env['GITHUB_SHA'],
        env['CI_COMMIT_SHA'],
      ]),
      refName: _firstNonEmpty([
        _defaultBuildRefName,
        env['PICKFORGE_BUILD_REF'],
        env['GITHUB_REF_NAME'],
        env['GITHUB_REF'],
        env['CI_COMMIT_REF_NAME'],
      ]),
      workflow: _firstNonEmpty([
        _defaultBuildWorkflow,
        env['PICKFORGE_BUILD_WORKFLOW'],
        env['GITHUB_WORKFLOW'],
        env['CI_JOB_NAME'],
      ]),
      runId: _firstNonEmpty([
        _defaultBuildRunId,
        env['PICKFORGE_BUILD_RUN_ID'],
        env['GITHUB_RUN_ID'],
        env['CI_PIPELINE_ID'],
      ]),
      runNumber: _firstNonEmpty([
        _defaultBuildRunNumber,
        env['PICKFORGE_BUILD_RUN_NUMBER'],
        env['GITHUB_RUN_NUMBER'],
        env['CI_PIPELINE_IID'],
      ]),
      buildUrl: _firstNonEmpty([
        _defaultBuildUrl,
        env['PICKFORGE_BUILD_URL'],
        _githubActionsBuildUrl(env),
        env['CI_JOB_URL'],
        env['BUILD_URL'],
      ]),
    );
  }

  final String? commitSha;
  final String? refName;
  final String? workflow;
  final String? runId;
  final String? runNumber;
  final String? buildUrl;

  bool get isEmpty =>
      commitSha == null &&
      refName == null &&
      workflow == null &&
      runId == null &&
      runNumber == null &&
      buildUrl == null;

  String? get runLabel => switch ((runNumber, runId)) {
        (final number?, final id?) => '$number ($id)',
        (final number?, null) => number,
        (null, final id?) => id,
        _ => null,
      };

  @override
  List<Object?> get props => [
        commitSha,
        refName,
        workflow,
        runId,
        runNumber,
        buildUrl,
      ];
}

enum DiagnosticsFailureKind { connection, run, agent }

class DiagnosticsFailureDetails extends Equatable {
  const DiagnosticsFailureDetails({
    required this.kind,
    required this.timestamp,
    required this.message,
  });

  final DiagnosticsFailureKind kind;
  final DateTime timestamp;
  final String message;

  String get clipboardText => [
        'Kind: ${kind.name}',
        'Time: ${timestamp.toIso8601String()}',
        'Message: $message',
      ].join('\n');

  @override
  List<Object?> get props => [kind, timestamp, message];
}

class DiagnosticsPerformanceCounter extends Equatable {
  const DiagnosticsPerformanceCounter({
    required this.name,
    required this.lastDuration,
    required this.maxDuration,
    required this.sampleCount,
    required this.recordedAt,
  });

  final String name;
  final Duration lastDuration;
  final Duration maxDuration;
  final int sampleCount;
  final DateTime recordedAt;

  @override
  List<Object?> get props => [
        name,
        lastDuration,
        maxDuration,
        sampleCount,
        recordedAt,
      ];
}

class DiagnosticsService {
  DiagnosticsService(
    this._runner, {
    ContextRedactor redactor = const ContextRedactor(),
    int maxLogEntries = 100,
    int maxPerformanceCounters = 50,
    String appVersion = _defaultAppVersion,
    DiagnosticsBuildMetadata? buildMetadata,
  })  : _redactor = redactor,
        _maxLogEntries = maxLogEntries,
        _maxPerformanceCounters = maxPerformanceCounters,
        _appVersion = appVersion,
        _buildMetadata =
            buildMetadata ?? DiagnosticsBuildMetadata.fromEnvironment();

  final ProcessRunner _runner;
  final ContextRedactor _redactor;
  final int _maxLogEntries;
  final int _maxPerformanceCounters;
  final String _appVersion;
  final DiagnosticsBuildMetadata _buildMetadata;
  final List<DiagnosticsLogEntry> _logs = [];
  final Map<DiagnosticsFailureKind, DiagnosticsFailureDetails> _failures = {};
  final Map<String, DiagnosticsPerformanceCounter> _performanceCounters = {};
  String? _lastVmError;

  /// Every redacted record is forwarded here in addition to the in-memory
  /// ring buffer. App logging points this at the run-log file so failures
  /// and legacy `recordLog` call sites land on disk too.
  void Function(String level, String message)? onRecord;

  String get appVersion => _appVersion;
  DiagnosticsBuildMetadata get buildMetadata => _buildMetadata;

  Future<DiagnosticsSnapshot> snapshot() async {
    final flutter = await _commandStatus('fvm', ['flutter', '--version']);
    return DiagnosticsSnapshot(
      appVersion: _appVersion,
      buildMetadata: _buildMetadata,
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
      failures: failures,
      performanceCounters: performanceCounters,
    );
  }

  List<DiagnosticsLogEntry> get logs => List.unmodifiable(_logs);
  List<DiagnosticsFailureDetails> get failures {
    final values = _failures.values.toList()
      ..sort((a, b) => a.kind.index.compareTo(b.kind.index));
    return List.unmodifiable(values);
  }

  List<DiagnosticsPerformanceCounter> get performanceCounters {
    final values = _performanceCounters.values.toList()
      ..sort((a, b) => a.name.compareTo(b.name));
    return List.unmodifiable(values);
  }

  String? get lastVmError => _lastVmError;

  void recordLog(String level, String message) {
    final redacted = _redactor.redact(message);
    _logs.add(
      DiagnosticsLogEntry(
        timestamp: DateTime.now().toUtc(),
        level: level,
        message: redacted,
      ),
    );
    if (_logs.length > _maxLogEntries) {
      _logs.removeRange(0, _logs.length - _maxLogEntries);
    }
    onRecord?.call(level, redacted);
  }

  void recordVmError(String message) {
    final redacted = _redactor.redact(message);
    _lastVmError = redacted;
    recordFailure(DiagnosticsFailureKind.connection, redacted);
  }

  void recordRunError(String message) {
    recordFailure(DiagnosticsFailureKind.run, message);
  }

  void recordAgentError(String message) {
    recordFailure(DiagnosticsFailureKind.agent, message);
  }

  void recordFailure(DiagnosticsFailureKind kind, String message) {
    final redacted = _redactor.redact(message);
    _failures[kind] = DiagnosticsFailureDetails(
      kind: kind,
      timestamp: DateTime.now().toUtc(),
      message: redacted,
    );
    recordLog('error', '${_failureLabel(kind)}: $redacted');
  }

  void recordPerformance(String name, Duration elapsed) {
    final redactedName = _redactor.redact(name).trim();
    if (redactedName.isEmpty) return;
    final current = _performanceCounters[redactedName];
    final maxDuration = current == null || elapsed > current.maxDuration
        ? elapsed
        : current.maxDuration;
    _performanceCounters[redactedName] = DiagnosticsPerformanceCounter(
      name: redactedName,
      lastDuration: elapsed,
      maxDuration: maxDuration,
      sampleCount: (current?.sampleCount ?? 0) + 1,
      recordedAt: DateTime.now().toUtc(),
    );
    if (_performanceCounters.length > _maxPerformanceCounters) {
      final oldest = _performanceCounters.values.reduce(
        (a, b) => a.recordedAt.isBefore(b.recordedAt) ? a : b,
      );
      _performanceCounters.remove(oldest.name);
    }
  }

  Future<String> buildSupportBundle({
    String? activeProjectRoot,
    String? lastVmError,
    String? runLogTail,
  }) async {
    final current = await snapshot();
    final vmError =
        _nonEmptyValue(lastVmError) ?? _nonEmptyValue(current.lastVmError);
    final buffer = StringBuffer()
      ..writeln('# Pickforge Support Bundle')
      ..writeln()
      ..writeln('Source files, prompts, screenshots, and secrets: excluded')
      ..writeln()
      ..writeln('## Environment')
      ..writeln()
      ..writeln('- App version: ${current.appVersion}')
      ..write(_buildMetadataLines(current.buildMetadata))
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

    if (current.failures.isNotEmpty) {
      buffer
        ..writeln()
        ..writeln('## Recent failures')
        ..writeln();
      for (final failure in current.failures) {
        buffer.writeln(
          '- ${failure.timestamp.toIso8601String()} '
          '[${_failureLabel(failure.kind)}] ${failure.message}',
        );
      }
    }

    if (current.performanceCounters.isNotEmpty) {
      buffer
        ..writeln()
        ..writeln('## Performance counters')
        ..writeln();
      for (final counter in current.performanceCounters) {
        buffer.writeln(
          '- ${counter.name}: last ${counter.lastDuration.inMilliseconds}ms, '
          'max ${counter.maxDuration.inMilliseconds}ms, '
          '${_sampleLabel(counter.sampleCount)}',
        );
      }
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
    if (_nonEmptyValue(runLogTail) case final tail?) {
      buffer
        ..writeln()
        ..writeln('## Current run log (tail)')
        ..writeln()
        ..writeln(tail);
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

  String _projectLabel(String? activeProjectRoot) {
    if (activeProjectRoot == null || activeProjectRoot.trim().isEmpty) {
      return 'none';
    }
    // basename handles both / and \ so labels stay correct for project
    // roots recorded on another host.
    return p.basename(activeProjectRoot);
  }

  String _availability(bool value) => value ? 'available' : 'missing';

  String _sampleLabel(int count) => count == 1 ? '1 sample' : '$count samples';

  String _failureLabel(DiagnosticsFailureKind kind) => switch (kind) {
        DiagnosticsFailureKind.connection => 'connection',
        DiagnosticsFailureKind.run => 'run',
        DiagnosticsFailureKind.agent => 'agent',
      };

  String _buildMetadataLines(DiagnosticsBuildMetadata metadata) {
    if (metadata.isEmpty) return '';
    final buffer = StringBuffer();
    if (metadata.commitSha case final value?) {
      buffer.writeln('- Build commit: $value');
    }
    if (metadata.refName case final value?) {
      buffer.writeln('- Build ref: $value');
    }
    if (metadata.workflow case final value?) {
      buffer.writeln('- Build workflow: $value');
    }
    if (metadata.runLabel case final value?) {
      buffer.writeln('- Build run: $value');
    }
    if (metadata.buildUrl case final value?) {
      buffer.writeln('- Build URL: $value');
    }
    return buffer.toString();
  }
}

String? _firstNonEmpty(Iterable<String?> values) {
  for (final value in values) {
    final trimmed = _nonEmptyValue(value);
    if (trimmed != null) return trimmed;
  }
  return null;
}

String? _nonEmptyValue(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

String? _githubActionsBuildUrl(Map<String, String> env) {
  final serverUrl = _nonEmptyValue(env['GITHUB_SERVER_URL']);
  final repository = _nonEmptyValue(env['GITHUB_REPOSITORY']);
  final runId = _nonEmptyValue(env['GITHUB_RUN_ID']);
  if (serverUrl == null || repository == null || runId == null) return null;
  return '$serverUrl/$repository/actions/runs/$runId';
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

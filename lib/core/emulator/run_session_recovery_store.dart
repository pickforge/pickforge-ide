import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/projects/pickforge_project_directory.dart';

class RunSessionRecoveryMetadata extends Equatable {
  const RunSessionRecoveryMetadata({
    required this.sessionId,
    required this.projectRoot,
    required this.pid,
    required this.serial,
    required this.startedAt,
    this.avdId,
    this.avdName,
    this.targetFile,
    this.extraArgs = const [],
    this.vmServiceUri,
    this.appId,
    this.ipcSocketPath,
  });

  factory RunSessionRecoveryMetadata.fromJson(Map<String, Object?> json) {
    return RunSessionRecoveryMetadata(
      sessionId: json['sessionId']! as String,
      projectRoot: json['projectRoot']! as String,
      pid: json['pid']! as int,
      serial: json['serial']! as String,
      startedAt: DateTime.parse(json['startedAt']! as String),
      avdId: json['avdId'] as String?,
      avdName: json['avdName'] as String?,
      targetFile: json['targetFile'] as String?,
      extraArgs:
          (json['extraArgs'] as List<dynamic>? ?? const []).cast<String>(),
      vmServiceUri: json['vmServiceUri'] as String?,
      appId: json['appId'] as String?,
      ipcSocketPath: json['ipcSocketPath'] as String?,
    );
  }

  final String sessionId;
  final String projectRoot;
  final int pid;
  final String serial;
  final DateTime startedAt;
  final String? avdId;
  final String? avdName;
  final String? targetFile;
  final List<String> extraArgs;
  final String? vmServiceUri;
  final String? appId;
  final String? ipcSocketPath;

  bool get canAdopt => vmServiceUri != null && vmServiceUri!.isNotEmpty;

  Map<String, Object?> toJson() => {
        'sessionId': sessionId,
        'projectRoot': projectRoot,
        'pid': pid,
        'serial': serial,
        'startedAt': startedAt.toUtc().toIso8601String(),
        'avdId': avdId,
        'avdName': avdName,
        'targetFile': targetFile,
        'extraArgs': extraArgs,
        'vmServiceUri': vmServiceUri,
        'appId': appId,
        'ipcSocketPath': ipcSocketPath,
      };

  RunSessionRecoveryMetadata copyWith({
    String? sessionId,
    String? projectRoot,
    int? pid,
    String? serial,
    DateTime? startedAt,
    Object? avdId = _unset,
    Object? avdName = _unset,
    Object? targetFile = _unset,
    List<String>? extraArgs,
    Object? vmServiceUri = _unset,
    Object? appId = _unset,
    Object? ipcSocketPath = _unset,
  }) {
    return RunSessionRecoveryMetadata(
      sessionId: sessionId ?? this.sessionId,
      projectRoot: projectRoot ?? this.projectRoot,
      pid: pid ?? this.pid,
      serial: serial ?? this.serial,
      startedAt: startedAt ?? this.startedAt,
      avdId: avdId == _unset ? this.avdId : avdId as String?,
      avdName: avdName == _unset ? this.avdName : avdName as String?,
      targetFile:
          targetFile == _unset ? this.targetFile : targetFile as String?,
      extraArgs: extraArgs ?? this.extraArgs,
      vmServiceUri:
          vmServiceUri == _unset ? this.vmServiceUri : vmServiceUri as String?,
      appId: appId == _unset ? this.appId : appId as String?,
      ipcSocketPath: ipcSocketPath == _unset
          ? this.ipcSocketPath
          : ipcSocketPath as String?,
    );
  }

  @override
  List<Object?> get props => [
        sessionId,
        projectRoot,
        pid,
        serial,
        startedAt,
        avdId,
        avdName,
        targetFile,
        extraArgs,
        vmServiceUri,
        appId,
        ipcSocketPath,
      ];
}

class RunProcessInspection extends Equatable {
  const RunProcessInspection({
    required this.running,
    this.commandLine = const [],
    this.cwd,
  });

  final bool running;
  final List<String> commandLine;
  final String? cwd;

  @override
  List<Object?> get props => [running, commandLine, cwd];
}

class RunProcessProbe {
  const RunProcessProbe();

  Future<RunProcessInspection> inspect(int pid) async {
    final cmdline = File('/proc/$pid/cmdline');
    if (!cmdline.existsSync()) {
      return const RunProcessInspection(running: false);
    }
    final args = utf8
        .decode(await cmdline.readAsBytes(), allowMalformed: true)
        .split('\u0000')
        .where((arg) => arg.isNotEmpty)
        .toList();
    String? cwd;
    final cwdLink = Link('/proc/$pid/cwd');
    if (cwdLink.existsSync()) {
      try {
        cwd = cwdLink.resolveSymbolicLinksSync();
      } on FileSystemException {
        cwd = null;
      }
    }
    return RunProcessInspection(running: true, commandLine: args, cwd: cwd);
  }

  Future<bool> terminate(int pid) async => Process.killPid(pid);
}

class RunSessionRecoveryStore {
  const RunSessionRecoveryStore({this.probe = const RunProcessProbe()});

  final RunProcessProbe probe;

  Future<void> persist(RunSessionRecoveryMetadata metadata) async {
    final file = await _fileFor(metadata.projectRoot, metadata.sessionId);
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(metadata.toJson()), flush: true);
  }

  Future<RunSessionRecoveryMetadata?> findRecoverable(
    String projectRoot,
  ) async {
    final runs = Directory(p.join(projectRoot, '.pickforge', 'runs'));
    if (!runs.existsSync()) return null;
    final candidates = <RunSessionRecoveryMetadata>[];
    await for (final entity in runs.list(followLinks: false)) {
      if (entity is! Directory) continue;
      final file = File(p.join(entity.path, 'session.json'));
      if (!file.existsSync()) continue;
      try {
        candidates.add(
          RunSessionRecoveryMetadata.fromJson(
            (jsonDecode(await file.readAsString()) as Map<String, dynamic>)
                .cast<String, Object?>(),
          ),
        );
      } on Object {
        try {
          await file.delete();
        } on Object {
          continue;
        }
      }
    }
    candidates.sort((a, b) => b.startedAt.compareTo(a.startedAt));
    for (final metadata in candidates) {
      if (await isRecoverable(metadata)) return metadata;
      await remove(metadata);
    }
    return null;
  }

  Future<void> remove(RunSessionRecoveryMetadata metadata) async {
    final file = await _fileFor(metadata.projectRoot, metadata.sessionId);
    if (file.existsSync()) await file.delete();
  }

  Future<void> cleanup(RunSessionRecoveryMetadata metadata) async {
    if (await isRecoverable(metadata)) {
      await probe.terminate(metadata.pid);
    }
    await remove(metadata);
  }

  Future<bool> isRecoverable(RunSessionRecoveryMetadata metadata) async {
    final inspection = await probe.inspect(metadata.pid);
    return _matches(metadata, inspection);
  }

  Future<File> _fileFor(String projectRoot, String sessionId) async {
    final dir = await PickforgeProjectDirectory.ensure(projectRoot);
    return File(p.join(dir.path, 'runs', sessionId, 'session.json'));
  }

  bool _matches(
    RunSessionRecoveryMetadata metadata,
    RunProcessInspection inspection,
  ) {
    if (!inspection.running) return false;
    if (!_isFlutterRunMachine(inspection.commandLine)) return false;
    final cwd = inspection.cwd;
    if (cwd == null) return false;
    return p.equals(p.canonicalize(cwd), p.canonicalize(metadata.projectRoot));
  }

  bool _isFlutterRunMachine(List<String> args) {
    final hasFlutterTool = args.any(
      (arg) =>
          p.basename(arg).toLowerCase().contains('flutter') ||
          arg.contains('flutter_tools'),
    );
    return hasFlutterTool && args.contains('run') && args.contains('--machine');
  }
}

const _unset = Object();

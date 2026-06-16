import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/targets/native_android/native_android_command_builder.dart';
import 'package:pickforge/core/targets/native_android/native_android_project_detector.dart';
import 'package:pickforge/core/targets/target_detection.dart';

/// How far the native Android launch progressed.
enum NativeAndroidLaunchStage { installFailed, installedNoLaunch, launched }

/// The outcome of a native Android build/install/launch.
class NativeAndroidLaunchResult extends Equatable {
  const NativeAndroidLaunchResult({
    required this.stage,
    this.applicationId,
    this.reason,
  });

  final NativeAndroidLaunchStage stage;
  final String? applicationId;
  final String? reason;

  bool get installed => stage != NativeAndroidLaunchStage.installFailed;
  bool get launched => stage == NativeAndroidLaunchStage.launched;

  @override
  List<Object?> get props => [stage, applicationId, reason];
}

/// Installs the debug app via Gradle and best-effort launches it via ADB.
///
/// Launch uses the monkey LAUNCHER intent against the statically-resolved
/// `applicationId` (or `namespace` fallback); when neither can be resolved the
/// app is installed but not launched, reported honestly via the result stage.
class NativeAndroidAppLauncher {
  NativeAndroidAppLauncher(
    this._runner, {
    NativeAndroidCommandBuilder commands = const NativeAndroidCommandBuilder(),
  }) : _commands = commands;

  final ProcessRunner _runner;
  final NativeAndroidCommandBuilder _commands;

  // Left guard `(?<![\w.])` rejects extension properties like `ext.applicationId`
  // and identifiers like `_applicationId`, so only the real DSL key matches.
  static final _applicationId =
      RegExp(r'''(?<![\w.])applicationId\s*=?\s*['"]([^'"]+)['"]''');
  static final _namespace =
      RegExp(r'''(?<![\w.])namespace\s*=?\s*['"]([^'"]+)['"]''');
  static final _applicationIdSuffix = RegExp(r'(?<![\w.])applicationIdSuffix');
  // A standalone `applicationId` config key (not `...Suffix`, not part of a
  // larger identifier or an extension property) — present but non-literal means
  // a dynamic value we can't resolve statically.
  static final _dynamicApplicationId =
      RegExp(r'(?<![\w.])applicationId(?![\w])');
  static final _packageId =
      RegExp(r'^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$');

  Future<NativeAndroidLaunchResult> launch({
    required NativeAndroidProjectInfo project,
    String? serial,
  }) async {
    final module = _primaryModule(project);
    if (module == null) {
      return const NativeAndroidLaunchResult(
        stage: NativeAndroidLaunchStage.installFailed,
        reason: 'no_application_module',
      );
    }

    final install = _commands.installDebug(
      project: project,
      gradlePath: module.gradlePath,
      serial: serial,
    );
    final installResult = await _runner.run(
      install.executable,
      install.arguments,
      cwd: install.cwd,
      env: install.env,
    );
    if (installResult.exitCode != 0) {
      return const NativeAndroidLaunchResult(
        stage: NativeAndroidLaunchStage.installFailed,
        reason: 'install_failed',
      );
    }

    final applicationId = await _resolveApplicationId(project, module);
    if (applicationId == null) {
      return const NativeAndroidLaunchResult(
        stage: NativeAndroidLaunchStage.installedNoLaunch,
        reason: 'application_id_unresolved',
      );
    }

    final launch = _commands.monkeyLaunch(
      project: project,
      applicationId: applicationId,
      serial: serial,
    );
    final launchResult = await _runner.run(
      launch.executable,
      launch.arguments,
      cwd: launch.cwd,
      env: launch.env,
    );
    return NativeAndroidLaunchResult(
      stage: launchResult.exitCode == 0
          ? NativeAndroidLaunchStage.launched
          : NativeAndroidLaunchStage.installedNoLaunch,
      applicationId: applicationId,
      reason: launchResult.exitCode == 0 ? null : 'launch_failed',
    );
  }

  NativeAndroidModuleInfo? _primaryModule(NativeAndroidProjectInfo project) {
    final modules = project.applicationModules;
    if (modules.isEmpty) return null;
    return modules.firstWhere(
      (m) => m.confidence == DetectionConfidence.exact,
      orElse: () => modules.first,
    );
  }

  /// Best-effort static resolution of the launchable package id. Returns null
  /// (→ install-only) whenever the final id can't be known confidently from the
  /// Gradle file alone — notably when an `applicationIdSuffix` or a non-literal
  /// `applicationId` is present, since the installed package would differ.
  Future<String?> _resolveApplicationId(
    NativeAndroidProjectInfo project,
    NativeAndroidModuleInfo module,
  ) async {
    try {
      final file = File(p.join(project.projectRoot, module.buildFile));
      if (!file.existsSync()) return null;
      final content = _stripComments(await file.readAsString());

      // A suffix (e.g. debug `.debug`) changes the installed id; don't guess.
      if (_applicationIdSuffix.hasMatch(content)) return null;

      final literal = _applicationId.firstMatch(content)?.group(1);
      if (literal != null) {
        return _packageId.hasMatch(literal) ? literal : null;
      }
      // applicationId is declared but not a literal string → dynamic; honestly
      // don't fall back to namespace.
      if (_dynamicApplicationId.hasMatch(content)) return null;

      // No applicationId at all → AGP defaults it to the namespace.
      final namespace = _namespace.firstMatch(content)?.group(1);
      if (namespace != null && _packageId.hasMatch(namespace)) return namespace;
      return null;
    } on FileSystemException {
      return null;
    }
  }

  String _stripComments(String content) {
    return content
        .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), '')
        .replaceAll(RegExp('//[^\n]*'), '');
  }
}

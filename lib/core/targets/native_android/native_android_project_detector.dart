import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/targets/target_detection.dart';

/// A Gradle module that looks like an Android application.
class NativeAndroidModuleInfo extends Equatable {
  const NativeAndroidModuleInfo({
    required this.gradlePath,
    required this.buildFile,
    required this.confidence,
  });

  /// Gradle path, e.g. `:app` or `:` (the root project).
  final String gradlePath;

  /// Project-relative build file path.
  final String buildFile;

  /// `exact` when it applies `com.android.application`; `likely` from softer
  /// Android markers.
  final DetectionConfidence confidence;

  @override
  List<Object?> get props => [gradlePath, buildFile, confidence];
}

/// What an Android Studio / Gradle project root looks like to PickForge.
class NativeAndroidProjectInfo extends Equatable {
  const NativeAndroidProjectInfo({
    required this.projectRoot,
    required this.settingsFile,
    required this.rootBuildFile,
    required this.hasGradleWrapper,
    required this.applicationModules,
  });

  final String projectRoot;
  final String settingsFile;
  final String rootBuildFile;
  final bool hasGradleWrapper;
  final List<NativeAndroidModuleInfo> applicationModules;

  bool get hasExactApplicationModule =>
      applicationModules.any((m) => m.confidence == DetectionConfidence.exact);

  @override
  List<Object?> get props => [
        projectRoot,
        settingsFile,
        rootBuildFile,
        hasGradleWrapper,
        applicationModules,
      ];
}

/// Detects native Android (Gradle) projects from a project root.
///
/// Requires a ROOT `settings.gradle[.kts]` + `build.gradle[.kts]` plus at least
/// one Android application module. Keying off the ROOT settings file keeps
/// Flutter (pubspec at root, wins at higher priority) and React Native
/// (package.json at root) projects — whose Gradle files live under `android/` —
/// from being misclassified.
class NativeAndroidProjectDetector {
  const NativeAndroidProjectDetector();

  static const int _maxBuildFileBytes = 512 * 1024;

  // Structured plugin ids (`id 'com.android.application'`,
  // `id("com.android.application")`, `apply plugin: '...'`) — the trailing
  // quote/paren avoids matching comments or `com.android.application.foo`.
  static final _applicationPlugin =
      RegExp(r'''com\.android\.application['")]''');
  static final _libraryPlugin = RegExp(r'''com\.android\.library['")]''');
  static final _androidLikely = RegExp(
    r'android\s*\{|compileSdk|namespace\s|defaultConfig',
  );

  Future<NativeAndroidProjectInfo?> detect(String projectRoot) async {
    final settingsFile = _firstExisting(
      projectRoot,
      const ['settings.gradle', 'settings.gradle.kts'],
    );
    if (settingsFile == null) return null;
    final rootBuildFile = _firstExisting(
      projectRoot,
      const ['build.gradle', 'build.gradle.kts'],
    );
    if (rootBuildFile == null) return null;

    final modules = await _applicationModules(projectRoot, rootBuildFile);
    if (modules.isEmpty) return null;

    return NativeAndroidProjectInfo(
      projectRoot: projectRoot,
      settingsFile: settingsFile,
      rootBuildFile: rootBuildFile,
      hasGradleWrapper: _hasGradleWrapper(projectRoot),
      applicationModules: modules,
    );
  }

  Future<List<NativeAndroidModuleInfo>> _applicationModules(
    String projectRoot,
    String rootBuildFile,
  ) async {
    final modules = <NativeAndroidModuleInfo>[];
    final candidates = <(String gradlePath, String relative, bool isAppModule)>[
      (':app', p.join('app', 'build.gradle'), true),
      (':app', p.join('app', 'build.gradle.kts'), true),
      (':', rootBuildFile, false),
    ];
    final seenPaths = <String>{};
    for (final (gradlePath, relative, isAppModule) in candidates) {
      if (seenPaths.contains(gradlePath)) continue;
      final content = await _readBuildFile(File(p.join(projectRoot, relative)));
      if (content == null) continue;
      final confidence = _classifyModule(content, isAppModule: isAppModule);
      if (confidence == null) continue;
      seenPaths.add(gradlePath);
      modules.add(
        NativeAndroidModuleInfo(
          gradlePath: gradlePath,
          buildFile: relative,
          confidence: confidence,
        ),
      );
    }
    return modules;
  }

  /// Classifies a build file as an Android APPLICATION module. A library module
  /// (`com.android.library` without the application plugin) is never an app, so
  /// the softer `android {}` markers only count for the `app/` module.
  DetectionConfidence? _classifyModule(
    String content, {
    required bool isAppModule,
  }) {
    if (_applicationPlugin.hasMatch(content)) return DetectionConfidence.exact;
    if (isAppModule &&
        !_libraryPlugin.hasMatch(content) &&
        _androidLikely.hasMatch(content)) {
      return DetectionConfidence.likely;
    }
    return null;
  }

  Future<String?> _readBuildFile(File file) async {
    try {
      if (!file.existsSync()) return null;
      if (await file.length() > _maxBuildFileBytes) return null;
      return _stripComments(await file.readAsString());
    } on FileSystemException {
      return null;
    }
  }

  // Drop `//` line comments and `/* */` block comments so a commented-out
  // plugin line doesn't count as a real plugin application.
  String _stripComments(String content) {
    return content
        .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), '')
        .replaceAll(RegExp('//[^\n]*'), '');
  }

  String? _firstExisting(String projectRoot, List<String> names) {
    for (final name in names) {
      if (File(p.join(projectRoot, name)).existsSync()) return name;
    }
    return null;
  }

  bool _hasGradleWrapper(String projectRoot) {
    return File(p.join(projectRoot, 'gradlew')).existsSync() ||
        File(p.join(projectRoot, 'gradlew.bat')).existsSync();
  }
}

import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// The JavaScript package manager driving a React Native project, inferred from
/// its lockfile.
enum ReactNativePackageManager { pnpm, yarn, npm, bun }

/// Expo-specific facts about a React Native project (Expo IS React Native, so
/// this rides on [ReactNativeProjectInfo] rather than a separate adapter).
///
/// Only present when the project declares the `expo` dependency — a bare RN CLI
/// project also ships an `app.json`, so the config file alone is NOT an Expo
/// signal. [configPath] just records which Expo config file exists, if any.
class ExpoProjectInfo extends Equatable {
  const ExpoProjectInfo({this.configPath});

  /// `app.json` / `app.config.js` / `app.config.ts`, or null.
  final String? configPath;

  bool get hasConfig => configPath != null;

  @override
  List<Object?> get props => [configPath];
}

/// What a React Native project root looks like to PickForge.
///
/// Produced by [ReactNativeProjectDetector]; only non-null when the project
/// actually declares a `react-native` dependency. [hasAndroidProject] gates
/// whether the Android adapter can drive it.
class ReactNativeProjectInfo extends Equatable {
  const ReactNativeProjectInfo({
    required this.projectRoot,
    required this.packageManager,
    required this.hasAndroidProject,
    required this.hasAndroidScript,
    this.expo,
  });

  final String projectRoot;
  final ReactNativePackageManager packageManager;
  final bool hasAndroidProject;
  final bool hasAndroidScript;
  final ExpoProjectInfo? expo;

  bool get isExpo => expo != null;

  @override
  List<Object?> get props => [
        projectRoot,
        packageManager,
        hasAndroidProject,
        hasAndroidScript,
        expo,
      ];
}

/// Detects React Native projects from a project root.
///
/// A project is React Native when its `package.json` lists `react-native` in
/// `dependencies` or `devDependencies`. The package manager is inferred from
/// the lockfile; the Android sub-project and `android` script are surfaced so
/// the adapter can decide whether Android support is available.
class ReactNativeProjectDetector {
  const ReactNativeProjectDetector();

  Future<ReactNativeProjectInfo?> detect(String projectRoot) async {
    final packageJson = File(p.join(projectRoot, 'package.json'));
    if (!packageJson.existsSync()) return null;

    final Object? decoded;
    try {
      decoded = jsonDecode(await packageJson.readAsString());
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;

    final hasReactNativeDep = _hasDependency(decoded, 'react-native');
    final hasExpoDep = _hasDependency(decoded, 'expo');
    // Expo IS React Native, so an Expo dependency counts even when the project
    // relies on the transitive `react-native` dependency.
    if (!hasReactNativeDep && !hasExpoDep) return null;

    // Expo only when the `expo` dependency is declared; the config file just
    // enriches which Expo config exists (a bare RN project also has app.json).
    final expo = hasExpoDep
        ? ExpoProjectInfo(configPath: _expoConfigPath(projectRoot))
        : null;

    return ReactNativeProjectInfo(
      projectRoot: projectRoot,
      packageManager: _detectPackageManager(projectRoot),
      hasAndroidProject: Directory(p.join(projectRoot, 'android')).existsSync(),
      hasAndroidScript: _hasAndroidScript(decoded),
      expo: expo,
    );
  }

  String? _expoConfigPath(String projectRoot) {
    for (final name in const ['app.json', 'app.config.js', 'app.config.ts']) {
      if (File(p.join(projectRoot, name)).existsSync()) return name;
    }
    return null;
  }

  bool _hasDependency(Map<String, dynamic> packageJson, String name) {
    for (final key in const ['dependencies', 'devDependencies']) {
      final deps = packageJson[key];
      if (deps is Map<String, dynamic> && deps.containsKey(name)) return true;
    }
    return false;
  }

  bool _hasAndroidScript(Map<String, dynamic> packageJson) {
    final scripts = packageJson['scripts'];
    return scripts is Map<String, dynamic> &&
        (scripts['android'] as Object?) != null;
  }

  ReactNativePackageManager _detectPackageManager(String projectRoot) {
    bool has(String name) => File(p.join(projectRoot, name)).existsSync();
    if (has('pnpm-lock.yaml')) return ReactNativePackageManager.pnpm;
    if (has('yarn.lock')) return ReactNativePackageManager.yarn;
    if (has('package-lock.json')) return ReactNativePackageManager.npm;
    if (has('bun.lockb') || has('bun.lock')) {
      return ReactNativePackageManager.bun;
    }
    return ReactNativePackageManager.npm;
  }
}

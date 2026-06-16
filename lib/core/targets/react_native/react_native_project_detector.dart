import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// The JavaScript package manager driving a React Native project, inferred from
/// its lockfile.
enum ReactNativePackageManager { pnpm, yarn, npm, bun }

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
  });

  final String projectRoot;
  final ReactNativePackageManager packageManager;
  final bool hasAndroidProject;
  final bool hasAndroidScript;

  @override
  List<Object?> get props => [
        projectRoot,
        packageManager,
        hasAndroidProject,
        hasAndroidScript,
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

    if (!_declaresReactNative(decoded)) return null;

    return ReactNativeProjectInfo(
      projectRoot: projectRoot,
      packageManager: _detectPackageManager(projectRoot),
      hasAndroidProject: Directory(p.join(projectRoot, 'android')).existsSync(),
      hasAndroidScript: _hasAndroidScript(decoded),
    );
  }

  bool _declaresReactNative(Map<String, dynamic> packageJson) {
    for (final key in const ['dependencies', 'devDependencies']) {
      final deps = packageJson[key];
      if (deps is Map<String, dynamic> && deps.containsKey('react-native')) {
        return true;
      }
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

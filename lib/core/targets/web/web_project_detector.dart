import 'dart:convert';
import 'dart:io';

import 'package:equatable/equatable.dart';
import 'package:path/path.dart' as p;

/// What a web (browser) project root looks like to PickForge.
class WebProjectInfo extends Equatable {
  const WebProjectInfo({
    required this.projectRoot,
    required this.hasWebFramework,
    this.devScript,
  });

  final String projectRoot;

  /// A recognized web framework dependency (react-dom, vite, next, …).
  final bool hasWebFramework;

  /// The dev-server script to run (`dev` preferred, then `start`), or null.
  final String? devScript;

  bool get hasDevScript => devScript != null;

  @override
  List<Object?> get props => [projectRoot, hasWebFramework, devScript];
}

/// Detects web/browser projects from a project root.
///
/// React Native and Flutter are claimed by their higher-priority adapters
/// first, so this only needs a positive web signal: a recognized web framework
/// dependency, or a `dev`/`start` script in `package.json`.
class WebProjectDetector {
  const WebProjectDetector();

  static const _webFrameworks = {
    'react-dom',
    'next',
    'vue',
    'nuxt',
    'svelte',
    '@sveltejs/kit',
    '@angular/core',
    '@remix-run/react',
    'preact',
    'solid-js',
    'vite',
    'astro',
    'gatsby',
  };

  Future<WebProjectInfo?> detect(String projectRoot) async {
    final packageJson = File(p.join(projectRoot, 'package.json'));
    if (!packageJson.existsSync()) return null;

    final Object? decoded;
    try {
      decoded = jsonDecode(await packageJson.readAsString());
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, dynamic>) return null;

    // A `react-native` dependency makes this fundamentally a React Native
    // project (even with react-native-web's react-dom); it belongs to the
    // mobile vertical, not web.
    if (_hasAnyDependency(decoded, const ['react-native'])) return null;

    final hasWebFramework = _hasWebFramework(decoded);
    final devScript = _devScript(decoded);
    if (!hasWebFramework && devScript == null) return null;

    // Expo is mobile UNLESS there is a strong web-framework signal (Expo for
    // web with a real bundler). A bare Expo root (no `android/`) isn't claimed
    // by the RN adapter, so without this its `start` script would look web.
    if (!hasWebFramework && _hasAnyDependency(decoded, const ['expo'])) {
      return null;
    }

    return WebProjectInfo(
      projectRoot: projectRoot,
      hasWebFramework: hasWebFramework,
      devScript: devScript,
    );
  }

  bool _hasAnyDependency(Map<String, dynamic> packageJson, List<String> names) {
    for (final key in const ['dependencies', 'devDependencies']) {
      final deps = packageJson[key];
      if (deps is Map<String, dynamic> && names.any(deps.containsKey)) {
        return true;
      }
    }
    return false;
  }

  bool _hasWebFramework(Map<String, dynamic> packageJson) {
    for (final key in const ['dependencies', 'devDependencies']) {
      final deps = packageJson[key];
      if (deps is Map<String, dynamic> &&
          deps.keys.any(_webFrameworks.contains)) {
        return true;
      }
    }
    return false;
  }

  String? _devScript(Map<String, dynamic> packageJson) {
    final scripts = packageJson['scripts'];
    if (scripts is! Map<String, dynamic>) return null;
    for (final name in const ['dev', 'start']) {
      if ((scripts[name] as Object?) != null) return name;
    }
    return null;
  }
}

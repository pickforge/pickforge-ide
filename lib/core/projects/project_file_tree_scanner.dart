import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/projects/project_file_tree.dart';

class ProjectFileTreeScanner {
  const ProjectFileTreeScanner({
    this.maxDepth = 8,
    this.maxEntriesPerDirectory = 300,
  });

  final int maxDepth;
  final int maxEntriesPerDirectory;

  static const commonExcludes = {
    '.git',
    '.dart_tool',
    'build',
    '.gradle',
    'ios/Pods',
    'macos/Pods',
    'linux/flutter/ephemeral',
    'windows/flutter/ephemeral',
  };

  Future<List<ProjectFileNode>> scan(
    String projectRoot, {
    bool showHidden = false,
  }) async {
    final root = Directory(projectRoot);
    final rules = await _IgnoreRules.load(projectRoot);
    if (!root.existsSync()) return const [];
    return _scanDirectory(
      root,
      projectRoot: p.normalize(p.absolute(projectRoot)),
      rules: rules,
      showHidden: showHidden,
      depth: 0,
    );
  }

  Future<List<ProjectFileNode>> _scanDirectory(
    Directory directory, {
    required String projectRoot,
    required _IgnoreRules rules,
    required bool showHidden,
    required int depth,
  }) async {
    if (depth >= maxDepth) return const [];

    final nodes = <ProjectFileNode>[];
    var count = 0;
    await for (final entity in directory.list(followLinks: false)) {
      if (count >= maxEntriesPerDirectory) break;
      final name = p.basename(entity.path);
      final relative =
          p.relative(entity.path, from: projectRoot).replaceAll(r'\', '/');
      if (!showHidden && name.startsWith('.')) continue;
      if (_isExcluded(relative, name, rules)) continue;

      final type = FileSystemEntity.typeSync(
        entity.path,
        followLinks: false,
      );
      final isDirectory = type == FileSystemEntityType.directory;
      final children = isDirectory
          ? await _scanDirectory(
              Directory(entity.path),
              projectRoot: projectRoot,
              rules: rules,
              showHidden: showHidden,
              depth: depth + 1,
            )
          : const <ProjectFileNode>[];
      nodes.add(
        ProjectFileNode(
          path: entity.path,
          relativePath: relative,
          name: name,
          isDirectory: isDirectory,
          children: children,
        ),
      );
      count++;
    }
    nodes.sort((a, b) {
      if (a.isDirectory != b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return nodes;
  }

  bool _isExcluded(String relativePath, String name, _IgnoreRules rules) {
    if (commonExcludes.contains(name) ||
        commonExcludes.contains(relativePath)) {
      return true;
    }
    return rules.excludes(relativePath);
  }
}

class _IgnoreRules {
  const _IgnoreRules(this.patterns);

  final List<_IgnorePattern> patterns;

  static Future<_IgnoreRules> load(String projectRoot) async {
    final files = [
      (file: File(p.join(projectRoot, '.gitignore')), basePath: ''),
      (
        file: File(p.join(projectRoot, '.pickforge', '.gitignore')),
        basePath: '.pickforge',
      ),
    ];
    final patterns = <_IgnorePattern>[];
    for (final (:file, :basePath) in files) {
      if (!file.existsSync()) continue;
      for (final line in await file.readAsLines()) {
        final trimmed = line.trim();
        if (trimmed.isEmpty || trimmed.startsWith('#')) {
          continue;
        }
        final negated = trimmed.startsWith('!');
        final pattern = negated ? trimmed.substring(1) : trimmed;
        if (pattern.trim().isEmpty) continue;
        patterns.add(
          _IgnorePattern(
            basePath: basePath,
            pattern: pattern.replaceAll(r'\', '/'),
            negated: negated,
          ),
        );
      }
    }
    return _IgnoreRules(patterns);
  }

  bool excludes(String relativePath) {
    var ignored = false;
    for (final pattern in patterns) {
      if (pattern.matches(relativePath)) ignored = !pattern.negated;
    }
    return ignored;
  }
}

class _IgnorePattern {
  const _IgnorePattern({
    required this.basePath,
    required this.pattern,
    required this.negated,
  });

  final String basePath;
  final String pattern;
  final bool negated;

  bool matches(String relativePath) {
    final normalized = relativePath.replaceAll(r'\', '/');
    final pathInBase = _pathInBase(normalized);
    if (pathInBase == null) return false;

    final anchored = pattern.startsWith('/');
    final body = anchored ? pattern.substring(1) : pattern;
    if (body == '*') return pathInBase.isNotEmpty;
    if (body.endsWith('/')) {
      final dir = body.substring(0, body.length - 1);
      return _matchesPath(pathInBase, dir, anchored, directory: true);
    }
    return _matchesPath(pathInBase, body, anchored);
  }

  String? _pathInBase(String relativePath) {
    if (basePath.isEmpty) return relativePath;
    if (relativePath == basePath) return '';
    final prefix = '$basePath/';
    if (!relativePath.startsWith(prefix)) return null;
    return relativePath.substring(prefix.length);
  }

  bool _matchesPath(
    String relativePath,
    String pattern,
    bool anchored, {
    bool directory = false,
  }) {
    if (pattern.contains('*')) {
      final regex = RegExp(
        '^${RegExp.escape(pattern).replaceAll(r'\*', '.*')}\$',
      );
      if (regex.hasMatch(relativePath)) return true;
      return !anchored && relativePath.split('/').any(regex.hasMatch);
    }
    if (directory) {
      return relativePath == pattern || relativePath.startsWith('$pattern/');
    }
    if (anchored || pattern.contains('/')) {
      return relativePath == pattern;
    }
    return relativePath.split('/').contains(pattern);
  }
}

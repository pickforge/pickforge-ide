import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;

class FlutterRunMetadata {
  const FlutterRunMetadata({
    this.targetFiles = const [],
    this.flavors = const [],
  });

  final List<String> targetFiles;
  final List<String> flavors;
}

@lazySingleton
class FlutterRunTargetScanner {
  const FlutterRunTargetScanner();

  Future<FlutterRunMetadata> scan(String projectRoot) async {
    final targets = await _targetFiles(projectRoot);
    final flavors = {
      for (final target in targets) ...?_flavorFromTarget(target),
      ...await _gradleFlavors(projectRoot),
    }.toList()
      ..sort();
    return FlutterRunMetadata(targetFiles: targets, flavors: flavors);
  }

  Future<List<String>> _targetFiles(String projectRoot) async {
    final lib = Directory(p.join(projectRoot, 'lib'));
    if (!lib.existsSync()) return const [];
    final files = <String>[];
    await for (final entity in lib.list(followLinks: false)) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      if (!RegExp(r'^main(?:_[A-Za-z0-9-]+)?\.dart$').hasMatch(name)) {
        continue;
      }
      files.add('lib/$name');
    }
    files.sort((a, b) {
      if (a == 'lib/main.dart') return -1;
      if (b == 'lib/main.dart') return 1;
      return a.compareTo(b);
    });
    return files;
  }

  List<String>? _flavorFromTarget(String target) {
    final name = p.basenameWithoutExtension(target);
    if (!name.startsWith('main_')) return null;
    final flavor = name.substring('main_'.length);
    return flavor.isEmpty ? null : [flavor];
  }

  Future<List<String>> _gradleFlavors(String projectRoot) async {
    final files = [
      File(p.join(projectRoot, 'android', 'app', 'build.gradle')),
      File(p.join(projectRoot, 'android', 'app', 'build.gradle.kts')),
    ];
    final flavors = <String>{};
    for (final file in files) {
      if (!file.existsSync()) continue;
      final block = _blockNamed(await file.readAsString(), 'productFlavors');
      if (block == null) continue;
      flavors.addAll(_parseProductFlavors(block));
    }
    return flavors.toList()..sort();
  }

  String? _blockNamed(String source, String name) {
    final start = source.indexOf(name);
    if (start < 0) return null;
    final open = source.indexOf('{', start);
    if (open < 0) return null;
    var depth = 0;
    for (var i = open; i < source.length; i++) {
      final char = source[i];
      if (char == '{') depth++;
      if (char == '}') depth--;
      if (depth == 0) return source.substring(open + 1, i);
    }
    return null;
  }

  Iterable<String> _parseProductFlavors(String block) sync* {
    final createPattern = RegExp(
      r'''(?:create|maybeCreate)\(["']([^"']+)["']\)''',
    );
    for (final match in createPattern.allMatches(block)) {
      yield match.group(1)!;
    }
    final namedPattern = RegExp(
      r'^\s*([A-Za-z][A-Za-z0-9_-]*)\s*\{',
      multiLine: true,
    );
    for (final match in namedPattern.allMatches(block)) {
      yield match.group(1)!;
    }
  }
}

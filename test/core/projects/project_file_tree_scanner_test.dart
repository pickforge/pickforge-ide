import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';

void main() {
  late Directory tmp;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('pickforge_files_');
  });

  tearDown(() {
    tmp.deleteSync(recursive: true);
  });

  test('scans directories and sorts folders before files', () async {
    File(p.join(tmp.path, 'README.md')).writeAsStringSync('hello');
    Directory(p.join(tmp.path, 'lib')).createSync();
    File(p.join(tmp.path, 'lib', 'main.dart')).writeAsStringSync('void main()');

    final nodes = await const ProjectFileTreeScanner().scan(tmp.path);

    expect(nodes.first.name, 'lib');
    expect(nodes.first.children.single.relativePath, 'lib/main.dart');
    expect(nodes.last.name, 'README.md');
  });

  test('respects common excludes, gitignore, and hidden toggle', () async {
    Directory(p.join(tmp.path, '.git')).createSync();
    Directory(p.join(tmp.path, 'build')).createSync();
    Directory(p.join(tmp.path, 'lib')).createSync();
    Directory(p.join(tmp.path, '.config')).createSync();
    File(p.join(tmp.path, '.gitignore')).writeAsStringSync('ignored/\n*.log\n');
    Directory(p.join(tmp.path, 'ignored')).createSync();
    File(p.join(tmp.path, 'debug.log')).writeAsStringSync('log');
    File(p.join(tmp.path, 'lib', 'main.dart')).writeAsStringSync('void main()');

    final hiddenOff = await const ProjectFileTreeScanner().scan(tmp.path);
    final hiddenOn =
        await const ProjectFileTreeScanner().scan(tmp.path, showHidden: true);

    expect(hiddenOff.map((n) => n.name), ['lib']);
    expect(hiddenOn.map((n) => n.name), contains('.config'));
    expect(hiddenOn.map((n) => n.name), isNot(contains('.git')));
  });

  test('respects pickforge-local gitignore when hidden files are shown',
      () async {
    final pickforge = Directory(p.join(tmp.path, '.pickforge'))..createSync();
    File(p.join(pickforge.path, '.gitignore'))
        .writeAsStringSync('*\n!.gitignore\n');
    File(p.join(pickforge.path, 'widget-context.md')).writeAsStringSync(
      'private context',
    );

    final nodes =
        await const ProjectFileTreeScanner().scan(tmp.path, showHidden: true);
    final pickforgeNode = nodes.singleWhere(
      (node) => node.name == '.pickforge',
    );

    expect(
      pickforgeNode.children.map((node) => node.name),
      ['.gitignore'],
    );
  });

  test('does not follow symlink loops', () async {
    Directory(p.join(tmp.path, 'lib')).createSync();
    final link = Link(p.join(tmp.path, 'lib', 'loop'));
    try {
      link.createSync(tmp.path);
    } on FileSystemException {
      return;
    }

    final nodes = await const ProjectFileTreeScanner().scan(tmp.path);

    expect(nodes.single.children.single.isDirectory, isFalse);
  });

  test('enforces common file scan excludes', () async {
    Directory(p.join(tmp.path, 'lib')).createSync();
    File(p.join(tmp.path, 'lib', 'main.dart')).writeAsStringSync('void main()');
    for (final relativePath in ProjectFileTreeScanner.commonExcludes) {
      final excludedDir = Directory(
        p.joinAll([tmp.path, ...p.posix.split(relativePath)]),
      )..createSync(recursive: true);
      File(p.join(excludedDir.path, 'generated.txt')).writeAsStringSync(
        'ignored',
      );
    }

    final nodes = await const ProjectFileTreeScanner(
      maxEntriesPerDirectory: 1000,
    ).scan(tmp.path, showHidden: true);
    final relativePaths =
        _flatten(nodes).map((node) => node.relativePath).toSet();

    expect(relativePaths, contains('lib/main.dart'));
    for (final excluded in ProjectFileTreeScanner.commonExcludes) {
      expect(
        relativePaths.any(
          (path) => path == excluded || path.startsWith('$excluded/'),
        ),
        isFalse,
        reason: '$excluded should be excluded',
      );
    }
  });

  test('scans large fixture project within bounded budget', () async {
    _writeLargeFixture(tmp);

    final stopwatch = Stopwatch()..start();
    final nodes = await const ProjectFileTreeScanner(
      maxEntriesPerDirectory: 1000,
    ).scan(tmp.path);
    stopwatch.stop();

    final relativePaths =
        _flatten(nodes).map((node) => node.relativePath).toSet();

    expect(relativePaths, contains('lib/feature_00/widget_00.dart'));
    expect(relativePaths, contains('lib/feature_19/widget_24.dart'));
    expect(relativePaths, contains('test/feature_09/widget_09_test.dart'));
    expect(
      relativePaths.where((path) => path.startsWith('build/')),
      isEmpty,
    );
    expect(
      relativePaths.where((path) => path.startsWith('.dart_tool/')),
      isEmpty,
    );
    expect(relativePaths.where((path) => path.startsWith('.git/')), isEmpty);
    expect(nodes.map((node) => node.name), ['lib', 'test', 'README.md']);
    expect(stopwatch.elapsedMilliseconds, lessThan(2500));
  });
}

void _writeLargeFixture(Directory root) {
  File(p.join(root.path, 'README.md')).writeAsStringSync('fixture');
  for (var feature = 0; feature < 20; feature++) {
    final featureName = feature.toString().padLeft(2, '0');
    final libDir = Directory(p.join(root.path, 'lib', 'feature_$featureName'))
      ..createSync(recursive: true);
    for (var file = 0; file < 25; file++) {
      final fileName = file.toString().padLeft(2, '0');
      File(p.join(libDir.path, 'widget_$fileName.dart')).writeAsStringSync(
        'class Widget$fileName {}\n',
      );
    }
  }
  for (var feature = 0; feature < 10; feature++) {
    final featureName = feature.toString().padLeft(2, '0');
    final testDir = Directory(p.join(root.path, 'test', 'feature_$featureName'))
      ..createSync(recursive: true);
    for (var file = 0; file < 10; file++) {
      final fileName = file.toString().padLeft(2, '0');
      File(p.join(testDir.path, 'widget_${fileName}_test.dart'))
          .writeAsStringSync('void main() {}\n');
    }
  }
  for (final excluded in ['.git', '.dart_tool', 'build']) {
    final excludedDir = Directory(p.join(root.path, excluded))
      ..createSync(recursive: true);
    for (var file = 0; file < 150; file++) {
      File(p.join(excludedDir.path, 'generated_$file.txt')).writeAsStringSync(
        'excluded\n',
      );
    }
  }
}

Iterable<ProjectFileNode> _flatten(List<ProjectFileNode> nodes) sync* {
  for (final node in nodes) {
    yield node;
    yield* _flatten(node.children);
  }
}

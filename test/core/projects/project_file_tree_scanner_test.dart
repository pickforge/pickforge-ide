import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
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
}

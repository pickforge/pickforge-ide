import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/storage/project_id.dart';
import 'package:pickforge/core/terminal/pasted_image_store.dart';

void main() {
  late Directory projectRoot;

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-paste-');
  });

  tearDown(() => projectRoot.delete(recursive: true));

  // A `.pickforge/.gitignore` marker resolves the project to project-local
  // storage, which must remain byte-identical to the legacy layout.
  void markProjectLocal() {
    File(p.join(projectRoot.path, '.pickforge', '.gitignore'))
      ..parent.createSync(recursive: true)
      ..writeAsStringSync('*\n');
  }

  PastedImageStore projectLocalStore() {
    markProjectLocal();
    return PastedImageStore(ContextStorageService.forTesting());
  }

  test(
      'project-local: saves under .pickforge/pastes and returns a relative path',
      () async {
    final store = projectLocalStore();
    final bytes = Uint8List.fromList([1, 2, 3, 4]);

    final relPath = await store.save(bytes, projectRoot: projectRoot.path);

    expect(relPath, startsWith('.pickforge/pastes/paste-'));
    expect(relPath, endsWith('.png'));
    final file = File(p.join(projectRoot.path, relPath));
    expect(file.existsSync(), isTrue);
    expect(file.readAsBytesSync(), bytes);
  });

  test('project-local: consecutive saves do not collide', () async {
    final store = projectLocalStore();
    final a = await store.save(
      Uint8List.fromList([1]),
      projectRoot: projectRoot.path,
    );
    final b = await store.save(
      Uint8List.fromList([2]),
      projectRoot: projectRoot.path,
    );

    expect(a, isNot(b));
    expect(File(p.join(projectRoot.path, a)).existsSync(), isTrue);
    expect(File(p.join(projectRoot.path, b)).existsSync(), isTrue);
  });

  test('project-local: prunes pastes older than seven days on save', () async {
    final store = projectLocalStore();
    final dir = Directory(p.join(projectRoot.path, '.pickforge', 'pastes'))
      ..createSync(recursive: true);
    final stale = File(p.join(dir.path, 'paste-old.png'))
      ..writeAsBytesSync([0])
      ..setLastModifiedSync(
        DateTime.now().subtract(const Duration(days: 8)),
      );

    await store.save(Uint8List.fromList([1]), projectRoot: projectRoot.path);

    expect(stale.existsSync(), isFalse);
  });

  test('home mode: saves under <home>/projects/<id>/pastes (absolute path)',
      () async {
    final tmpHome = await Directory.systemTemp.createTemp('pickforge-home-');
    addTearDown(() => tmpHome.delete(recursive: true));
    final store = PastedImageStore(
      ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': tmpHome.path},
      ),
    );
    final bytes = Uint8List.fromList([9, 8, 7]);

    final pathOut = await store.save(bytes, projectRoot: projectRoot.path);

    final id = ProjectId.forRoot(projectRoot.path);
    final expectedDir = p.join(tmpHome.path, 'projects', id, 'pastes');
    expect(p.isAbsolute(pathOut), isTrue);
    expect(p.dirname(pathOut), expectedDir);
    expect(p.basename(pathOut), startsWith('paste-'));
    final file = File(pathOut);
    expect(file.existsSync(), isTrue);
    expect(file.readAsBytesSync(), bytes);
    // Nothing leaked into the project tree.
    expect(
      Directory(p.join(projectRoot.path, '.pickforge')).existsSync(),
      isFalse,
    );
  });
}

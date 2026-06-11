import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/projects_repository.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectsRepository repo;
  late Directory tmp;

  setUp(() async {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectsRepository(ProjectsDao(db));
    tmp = await Directory.systemTemp.createTemp('pf_proj_repo');
    File(p.join(tmp.path, 'pubspec.yaml')).writeAsStringSync('name: t');
  });

  tearDown(() async {
    await db.close();
    await tmp.delete(recursive: true);
  });

  test('add canonicalizes and de-dupes', () async {
    await repo.add(tmp.path);
    await repo.add('${tmp.path}/./');
    final all = await repo.list();
    expect(all, hasLength(1));
    expect(all.single.projectRoot, p.canonicalize(tmp.path));
  });

  test('add accepts any existing folder (not Flutter-only)', () async {
    final plain = await Directory.systemTemp.createTemp('pf_plain');
    addTearDown(() => plain.delete(recursive: true));
    final added = await repo.add(plain.path);
    expect(added.projectRoot, p.canonicalize(plain.path));
  });

  test('add rejects a folder that does not exist', () async {
    await expectLater(
      repo.add(p.join(tmp.path, 'nope')),
      throwsA(isA<ProjectAddError>()),
    );
  });

  test('archive hides a project from list and restore brings it back',
      () async {
    final added = await repo.add(tmp.path);
    await repo.archive(added.projectRoot);
    expect(await repo.list(), isEmpty);
    expect(await repo.archivedProjects(), hasLength(1));
    await repo.restore(added.projectRoot);
    expect(await repo.list(), hasLength(1));
    expect(await repo.archivedProjects(), isEmpty);
  });

  test('relocate re-points the project at the moved folder', () async {
    final added = await repo.add(tmp.path);
    final moved = await Directory.systemTemp.createTemp('pf_moved');
    addTearDown(() => moved.delete(recursive: true));
    await repo.relocate(added.projectRoot, moved.path);
    final all = await repo.list();
    expect(all.single.projectRoot, p.canonicalize(moved.path));
  });

  test('remove deletes the row', () async {
    await repo.add(tmp.path);
    await repo.remove(p.canonicalize(tmp.path));
    expect(await repo.list(), isEmpty);
  });
}

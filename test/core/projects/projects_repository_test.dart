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

  test('add rejects folder without pubspec.yaml', () async {
    final empty = await Directory.systemTemp.createTemp('pf_empty');
    await expectLater(repo.add(empty.path), throwsA(isA<ProjectAddError>()));
    await empty.delete();
  });

  test('remove deletes the row', () async {
    await repo.add(tmp.path);
    await repo.remove(p.canonicalize(tmp.path));
    expect(await repo.list(), isEmpty);
  });
}

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectsDao dao;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    dao = ProjectsDao(db);
  });

  tearDown(() async => db.close());

  test('upsert then read returns the row', () async {
    await dao.upsert(
      projectRoot: '/tmp/app',
      displayName: 'app',
      now: DateTime(2026, 4, 25, 14, 30),
    );

    final rows = await dao.allOrderedByLastOpened();

    expect(rows, hasLength(1));
    expect(rows.single.projectRoot, '/tmp/app');
    expect(rows.single.displayName, 'app');
  });

  test('upsert is idempotent on projectRoot', () async {
    await dao.upsert(
      projectRoot: '/tmp/x',
      displayName: 'x',
      now: DateTime(2026, 4, 25),
    );
    await dao.upsert(
      projectRoot: '/tmp/x',
      displayName: 'x renamed',
      now: DateTime(2026, 4, 26),
    );

    final rows = await dao.allOrderedByLastOpened();
    expect(rows, hasLength(1));
    expect(rows.single.displayName, 'x renamed');
  });

  test('remove deletes the row', () async {
    await dao.upsert(
      projectRoot: '/tmp/y',
      displayName: 'y',
      now: DateTime(2026, 4, 25),
    );
    await dao.remove('/tmp/y');
    expect(await dao.allOrderedByLastOpened(), isEmpty);
  });
}

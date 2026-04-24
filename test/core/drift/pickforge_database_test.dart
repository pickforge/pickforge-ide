import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('schema createAll runs cleanly on an empty database', () async {
    final tables = await db
        .customSelect(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .get();
    final names = tables.map((r) => r.data['name']).toList();
    expect(
      names,
      containsAll(['agent_run_log', 'pick_history', 'project_settings']),
    );
  });
}

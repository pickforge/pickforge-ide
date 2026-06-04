import 'dart:convert';
import 'dart:io';

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

  test('current schema has a tracked snapshot', () {
    final file = File(
      'test/core/drift/schema/pickforge_database_v${db.schemaVersion}.json',
    );

    expect(file.existsSync(), isTrue);
    final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    final entities = json['entities'] as List<dynamic>;
    final tableNames = entities
        .whereType<Map<String, dynamic>>()
        .where((entity) => entity['type'] == 'table')
        .map((entity) => (entity['data'] as Map<String, dynamic>)['name'])
        .toSet();

    expect(
      tableNames,
      containsAll(['agent_run_log', 'pick_history', 'project_settings']),
    );
  });
}

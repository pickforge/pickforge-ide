import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('insertPick + recent returns the row', () async {
    final id = await db.pickHistoryDao.insertPick(
      projectRoot: '/me/app',
      widgetClass: 'ElevatedButton',
      creationFile: 'lib/foo.dart',
      creationLine: 10,
      skillId: 'edit-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );
    expect(id, greaterThan(0));

    final recent = await db.pickHistoryDao.recent().first;
    expect(recent, hasLength(1));
    expect(recent.first.widgetClass, 'ElevatedButton');
  });

  test('agent run log increments hot reload counter', () async {
    final pickId = await db.pickHistoryDao.insertPick(
      projectRoot: '/me/app',
      widgetClass: 'X',
      creationFile: null,
      creationLine: null,
      skillId: 'edit-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );
    final runId = await db.agentRunLogDao.recordStart(
      pickId: pickId,
      wrapperScriptPath: '/tmp/w.sh',
    );
    await db.agentRunLogDao.incrementHotReload(runId);
    await db.agentRunLogDao.incrementHotReload(runId);
    final row = await (db.select(db.agentRunLog)
          ..where((t) => t.id.equals(runId)))
        .getSingle();
    expect(row.hotReloadCount, 2);
  });
}

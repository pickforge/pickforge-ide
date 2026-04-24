import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/history/cubit/history_cubit.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('emits row after insert', () async {
    final cubit = HistoryCubit(db);

    await db.pickHistoryDao.insertPick(
      projectRoot: '/tmp/test',
      widgetClass: 'ElevatedButton',
      creationFile: 'lib/main.dart',
      creationLine: 42,
      skillId: 'edit-widget',
      agentId: 'claude-code',
      terminalId: 'ghostty',
      widgetContextJson: '{}',
    );

    // Wait for Drift stream to emit.
    await Future<void>.delayed(Duration.zero);

    expect(cubit.state, hasLength(1));
    expect(cubit.state.first.widgetClass, 'ElevatedButton');

    await cubit.close();
  });
}

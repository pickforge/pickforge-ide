import 'dart:convert';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/history/pick_history_recorder.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('records selected widget metadata and context json', () async {
    const selection = SelectedWidget(
      node: WidgetNode(
        id: 'button-1',
        className: 'ElevatedButton',
        children: [],
        creationLocation: CreationLocation(
          file: 'lib/main.dart',
          line: 12,
          column: 8,
        ),
      ),
      ancestorClasses: ['MaterialApp', 'Scaffold'],
      sourceSnippet: 'ElevatedButton(onPressed: () {})',
      screenshotPath: null,
      adbScreenshotPath: null,
      propertiesJson: {'enabled': true},
    );

    final recorder = PickHistoryRecorder(db.pickHistoryDao);
    await recorder.recordSelection(
      projectRoot: '/tmp/app',
      selection: selection,
      forgeState: ForgeState.initial(),
      chatId: 'chat-1',
    );

    final rows = await db.pickHistoryDao.recent().first;
    expect(rows, hasLength(1));
    expect(rows.single.widgetClass, 'ElevatedButton');
    expect(rows.single.projectRoot, '/tmp/app');
    expect(rows.single.creationFile, 'lib/main.dart');
    expect(rows.single.creationLine, 12);
    expect(rows.single.skillId, 'edit-widget');
    expect(rows.single.agentId, 'claude-code');
    expect(rows.single.terminalId, 'ghostty');
    expect(rows.single.chatId, 'chat-1');

    final contextJson =
        jsonDecode(rows.single.widgetContextJson) as Map<String, dynamic>;
    final nodeJson = contextJson['node'] as Map<String, dynamic>;
    expect(nodeJson['id'], 'button-1');
  });
}

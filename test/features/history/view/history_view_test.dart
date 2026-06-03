import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/history/view/history_view.dart';

void main() {
  testWidgets('renders empty history state', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HistoryView(historyStream: Stream.value(const [])),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Pick History'), findsOneWidget);
    expect(find.text('No picks recorded yet'), findsOneWidget);
  });

  testWidgets('renders populated history rows', (tester) async {
    final rows = [
      PickHistoryRow(
        id: 1,
        projectRoot: '/tmp/sample_flutter_app',
        widgetClass: 'CounterPage',
        creationFile: 'lib/main.dart',
        creationLine: 42,
        skillId: 'edit-widget',
        agentId: 'codex',
        terminalId: 'ghostty',
        chatId: 'chat-1',
        pickedAt: DateTime(2026, 6, 3, 12, 30),
        widgetContextJson: '{}',
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: HistoryView(historyStream: Stream.value(rows)),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('CounterPage'), findsOneWidget);
    expect(find.text('Project: /tmp/sample_flutter_app'), findsOneWidget);
    expect(find.text('Location: lib/main.dart:42'), findsOneWidget);
    expect(find.text('Skill: edit-widget'), findsOneWidget);
    expect(find.text('Agent: codex'), findsOneWidget);
    expect(find.text('Picked: 2026-06-03 12:30'), findsOneWidget);
    expect(find.text('Chat: chat-1'), findsOneWidget);
  });
}

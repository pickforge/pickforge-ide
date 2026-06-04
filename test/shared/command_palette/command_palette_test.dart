import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette.dart';

void main() {
  testWidgets('filtering by typing "set" shows only Settings command',
      (tester) async {
    final commands = [
      PickforgeCommand(
        id: 'nav-dock',
        title: 'Go to Dock',
        hint: 'Widget picker',
        run: () {},
      ),
      PickforgeCommand(
        id: 'nav-connect',
        title: 'Go to Connect',
        hint: 'VM Service connection',
        run: () {},
      ),
      PickforgeCommand(
        id: 'nav-history',
        title: 'Go to History',
        hint: 'Pick history',
        run: () {},
      ),
      PickforgeCommand(
        id: 'nav-settings',
        title: 'Go to Settings',
        hint: 'App settings',
        run: () {},
      ),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return ElevatedButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => CommandPalette(commands: commands),
              ),
              child: const Text('Open'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();

    // All 4 commands visible initially
    expect(find.text('Go to Dock'), findsOneWidget);
    expect(find.text('Go to Connect'), findsOneWidget);
    expect(find.text('Go to History'), findsOneWidget);
    expect(find.text('Go to Settings'), findsOneWidget);

    // Type 'set' — only Settings should remain
    await tester.enterText(find.byType(TextField), 'set');
    await tester.pumpAndSettle();

    expect(find.text('Go to Settings'), findsOneWidget);
    expect(find.text('Go to Dock'), findsNothing);
    expect(find.text('Go to Connect'), findsNothing);
    expect(find.text('Go to History'), findsNothing);
  });

  testWidgets('query can load dynamic search commands', (tester) async {
    var ran = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return ElevatedButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => CommandPalette(
                  commands: const [],
                  searchCommands: (query) async => [
                    PickforgeCommand(
                      id: 'search-chat-1',
                      title: 'Transcript: Auth cleanup',
                      hint: 'Found "$query"',
                      run: () => ran = true,
                    ),
                  ],
                ),
              ),
              child: const Text('Open'),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'auth');
    await tester.pumpAndSettle();

    expect(find.text('Transcript: Auth cleanup'), findsOneWidget);
    await tester.tap(find.widgetWithText(ListTile, 'Transcript: Auth cleanup'));
    await tester.pumpAndSettle();

    expect(ran, isTrue);
  });
}

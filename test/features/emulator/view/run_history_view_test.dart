import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/emulator/view/run_history_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('renders no active project state', (tester) async {
    await tester.pumpWidget(_app(const RunHistoryView()));
    await tester.pumpAndSettle();

    expect(find.text('Run history'), findsOneWidget);
    expect(find.text('Select a project to view run history'), findsOneWidget);
  });

  testWidgets('renders empty run history state', (tester) async {
    await tester.pumpWidget(
      _app(
        RunHistoryView(
          projectRoot: '/tmp/app',
          historyStream: Stream.value(const []),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No run sessions recorded'), findsOneWidget);
  });

  testWidgets('renders populated run history rows', (tester) async {
    final rows = [
      RunSessionLogRow(
        sessionId: 'session-1',
        projectRoot: '/tmp/app',
        startedAt: DateTime(2026, 6, 3, 10, 15),
        endedAt: DateTime(2026, 6, 3, 10, 20),
        avdId: 'Pixel_10',
        avdName: 'Pixel 10',
        serial: 'emulator-5554',
        vmServiceUrl: 'ws://127.0.0.1/ws',
        targetFile: 'lib/main_dev.dart',
        connectionMode: 'auto',
        exitReason: 'crash',
        exitCode: 1,
        hotReloadCount: 2,
        hotRestartCount: 1,
        errorCount: 3,
        lastError: 'build failed',
      ),
    ];

    await tester.pumpWidget(
      _app(
        RunHistoryView(
          projectRoot: '/tmp/app',
          historyStream: Stream.value(rows),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Pixel 10'), findsOneWidget);
    expect(find.text('Project: /tmp/app'), findsOneWidget);
    expect(find.text('Session: session-1'), findsOneWidget);
    expect(find.text('Started: 2026-06-03 10:15'), findsOneWidget);
    expect(find.text('Ended: 2026-06-03 10:20'), findsOneWidget);
    expect(find.text('Target: lib/main_dev.dart'), findsOneWidget);
    expect(find.text('VM Service: ws://127.0.0.1/ws'), findsOneWidget);
    expect(find.text('Exit: crash'), findsOneWidget);
    expect(find.text('Exit code: 1'), findsOneWidget);
    expect(find.text('Hot reloads: 2'), findsOneWidget);
    expect(find.text('Hot restarts: 1'), findsOneWidget);
    expect(find.text('Errors: 3'), findsOneWidget);
    expect(find.text('Last error: build failed'), findsOneWidget);
  });
}

Widget _app(Widget home) {
  return MaterialApp(
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: home,
  );
}

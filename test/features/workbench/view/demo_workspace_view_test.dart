import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/workbench/view/demo_workspace_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

void main() {
  testWidgets('renders fake project, emulator, widget, and chat data',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DemoWorkspaceView(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('DEMO WORKSPACE'), findsOneWidget);
    expect(find.text('sample_flutter_app'), findsOneWidget);
    expect(find.text('Counter polish'), findsOneWidget);
    expect(find.text('Pixel 10'), findsOneWidget);
    expect(find.text('VM Service connected'), findsOneWidget);
    expect(find.text('CounterPage'), findsOneWidget);
    expect(find.text('widget-context.md'), findsNWidgets(2));
    expect(
      find.text('Prompt delivered to active Codex session'),
      findsOneWidget,
    );
  });

  testWidgets('fits the default narrow desktop window', (tester) async {
    tester.view.physicalSize = const Size(480, 720);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DemoWorkspaceView(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('DEMO WORKSPACE'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

const _sampleWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w1',
    className: 'Text',
    children: [],
    creationLocation: null,
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

void main() {
  setUp(() async {
    await configureDependencies();
  });

  tearDown(getIt.reset);

  testWidgets('ForgePanel renders Forge it button', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
          ),
        ),
      ),
    );

    expect(find.text('Forge it'), findsOneWidget);
  });

  testWidgets('ForgePanel button disabled when selection is null',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: null,
            projectRoot: '/tmp/test',
          ),
        ),
      ),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/agent_launcher.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';
import 'package:pickforge/core/terminal/pty_session_pool.dart';
import 'package:pickforge/features/forge/forge.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _sampleWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w1',
    className: 'Text',
    children: [],
    creationLocation: CreationLocation(
      file: '/tmp/test/lib/main.dart',
      line: 1,
      column: 1,
    ),
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

const _frameworkWidget = SelectedWidget(
  node: WidgetNode(
    id: 'w2',
    className: 'Text',
    children: [],
    creationLocation: CreationLocation(
      file: '/opt/flutter/packages/flutter/lib/src/widgets/text.dart',
      line: 1,
      column: 1,
    ),
  ),
  ancestorClasses: ['MaterialApp'],
  sourceSnippet: null,
  screenshotPath: null,
  adbScreenshotPath: null,
  propertiesJson: {},
);

class _RecordingForgeCubit extends ForgeCubit {
  _RecordingForgeCubit()
      : super(_ThrowingLauncher(), _ThrowingAdb(), _NoopPool());

  SelectedWidget? forgedSelection;
  String? forgedProjectRoot;
  String? forgedChatId;

  @override
  void selectSkill(SkillId skill) {
    emit(state.copyWith(skill: skill));
  }

  @override
  void selectAgent(AgentProfileId agentId) {
    emit(state.copyWith(agentId: agentId));
  }

  @override
  void selectTerminal(String terminalId) {
    emit(state.copyWith(terminalId: terminalId));
  }

  @override
  Future<void> forge({
    required SelectedWidget selection,
    required String projectRoot,
    required String chatId,
  }) async {
    forgedSelection = selection;
    forgedProjectRoot = projectRoot;
    forgedChatId = chatId;
  }
}

class _ThrowingLauncher extends Fake implements AgentLauncher {}

class _ThrowingAdb extends Fake implements AdbScreenshotCapturer {}

class _NoopPool extends Fake implements PtySessionPool {}

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
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
            chatId: 'chat-1',
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
            chatId: 'chat-1',
          ),
        ),
      ),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel button disabled when chat is null', (tester) async {
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
            chatId: null,
          ),
        ),
      ),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel button disabled for framework widgets',
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
            selection: _frameworkWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
          ),
        ),
      ),
    );

    expect(find.text('Pick a widget from your app source.'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('ForgePanel sends prompt to active chat', (tester) async {
    tester.view.physicalSize = const Size(1200, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final cubit = _RecordingForgeCubit();
    addTearDown(cubit.close);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: ForgePanel(
            selection: _sampleWidget,
            projectRoot: '/tmp/test',
            chatId: 'chat-1',
            cubit: cubit,
          ),
        ),
      ),
    );

    await tester.tap(find.text('Forge it'));
    await tester.pump();

    expect(cubit.forgedSelection, _sampleWidget);
    expect(cubit.forgedProjectRoot, '/tmp/test');
    expect(cubit.forgedChatId, 'chat-1');
  });
}

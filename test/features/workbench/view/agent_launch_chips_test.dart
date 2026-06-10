import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/workbench/view/agent_launch_chips.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class _MockDetector extends Mock implements BinaryDetector {}

class _MockModelSettings extends Mock implements AgentModelSettingsRepository {}

class _MockProjectSettings extends Mock implements ProjectSettingsRepository {}

void main() {
  setUpAll(() => registerFallbackValue(AgentProfileId.claudeCode));

  late _MockDetector detector;
  late _MockModelSettings models;
  late _MockProjectSettings projectSettings;

  setUp(() {
    detector = _MockDetector();
    models = _MockModelSettings();
    projectSettings = _MockProjectSettings();
    when(() => detector.isBinaryOnPath(any())).thenAnswer((_) async => true);
    when(() => models.modelFor(any())).thenReturn(null);
    when(() => projectSettings.getDefaultAgentId(any()))
        .thenAnswer((_) async => null);
    getIt
      ..registerSingleton<AgentProfileRegistry>(
        AgentProfileRegistry(const [ClaudeCodeProfile(), CodexProfile()]),
      )
      ..registerSingleton<BinaryDetector>(detector)
      ..registerSingleton<AgentModelSettingsRepository>(models)
      ..registerSingleton<ProjectSettingsRepository>(projectSettings);
  });

  tearDown(getIt.reset);

  Future<void> pump(
    WidgetTester tester, {
    required ValueChanged<String> onLaunch,
    bool enabled = true,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: AgentLaunchChips(
            projectRoot: '/p',
            chatAgentId: 'claude-code',
            enabled: enabled,
            onLaunch: onLaunch,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('tapping a chip emits the model-aware launch command',
      (tester) async {
    when(() => models.modelFor(AgentProfileId.claudeCode))
        .thenReturn('claude-haiku-4-5');
    final launched = <String>[];

    await pump(tester, onLaunch: launched.add);
    await tester.tap(find.text('CLAUDE CODE'));

    expect(launched, ['claude --model claude-haiku-4-5']);
  });

  testWidgets('a chip with a missing binary does not launch', (tester) async {
    when(() => detector.isBinaryOnPath('codex')).thenAnswer((_) async => false);
    final launched = <String>[];

    await pump(tester, onLaunch: launched.add);
    await tester.tap(find.text('CODEX'));

    expect(launched, isEmpty);
  });

  testWidgets('chips do not launch while the session is not running',
      (tester) async {
    final launched = <String>[];

    await pump(tester, onLaunch: launched.add, enabled: false);
    await tester.tap(find.text('CLAUDE CODE'));

    expect(launched, isEmpty);
  });

  testWidgets('renders the quick launch eyebrow', (tester) async {
    await pump(tester, onLaunch: (_) {});

    expect(find.text('QUICK LAUNCH'), findsOneWidget);
  });
}

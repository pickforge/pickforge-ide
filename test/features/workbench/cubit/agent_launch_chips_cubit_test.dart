import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/agent/models.dart';
import 'package:pickforge/core/agent/profiles/claude_code_profile.dart';
import 'package:pickforge/core/agent/profiles/codex_profile.dart';
import 'package:pickforge/core/agent/profiles/opencode_profile.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/workbench/cubit/agent_launch_chips_cubit.dart';

class _MockDetector extends Mock implements BinaryDetector {}

class _MockModelSettings extends Mock implements AgentModelSettingsRepository {}

class _MockProjectSettings extends Mock implements ProjectSettingsRepository {}

void main() {
  setUpAll(() => registerFallbackValue(AgentProfileId.claudeCode));

  late _MockDetector detector;
  late _MockModelSettings models;
  late _MockProjectSettings projectSettings;
  final registry = AgentProfileRegistry(const [
    ClaudeCodeProfile(),
    CodexProfile(),
    OpenCodeProfile(),
  ]);

  setUp(() {
    detector = _MockDetector();
    models = _MockModelSettings();
    projectSettings = _MockProjectSettings();
    when(() => detector.isBinaryOnPath(any())).thenAnswer((_) async => true);
    when(() => models.modelFor(any())).thenReturn(null);
    when(() => projectSettings.getDefaultAgentId(any()))
        .thenAnswer((_) async => null);
  });

  AgentLaunchChipsCubit cubit() =>
      AgentLaunchChipsCubit(registry, detector, models, projectSettings);

  test('builds a chip per profile with model-aware commands', () async {
    when(() => models.modelFor(AgentProfileId.claudeCode))
        .thenReturn('claude-haiku-4-5');
    final c = cubit();

    await c.load(projectRoot: '/p', chatAgentId: 'claude-code');

    expect(c.state.loaded, isTrue);
    expect(c.state.chips, hasLength(3));
    final claude =
        c.state.chips.firstWhere((x) => x.id == AgentProfileId.claudeCode);
    expect(claude.command, 'claude --model claude-haiku-4-5');
    final codex = c.state.chips.firstWhere((x) => x.id == AgentProfileId.codex);
    expect(codex.command, 'codex');
  });

  test('marks chips unavailable when the binary is missing', () async {
    when(() => detector.isBinaryOnPath('codex')).thenAnswer((_) async => false);
    final c = cubit();

    await c.load(projectRoot: '/p', chatAgentId: 'claude-code');

    final codex = c.state.chips.firstWhere((x) => x.id == AgentProfileId.codex);
    expect(codex.available, isFalse);
    final claude =
        c.state.chips.firstWhere((x) => x.id == AgentProfileId.claudeCode);
    expect(claude.available, isTrue);
  });

  test('emphasizes the project default agent and sorts it first', () async {
    when(() => projectSettings.getDefaultAgentId('/p'))
        .thenAnswer((_) async => 'codex');
    final c = cubit();

    await c.load(projectRoot: '/p', chatAgentId: 'claude-code');

    expect(c.state.chips.first.id, AgentProfileId.codex);
    expect(c.state.chips.first.emphasized, isTrue);
    expect(c.state.chips.where((x) => x.emphasized), hasLength(1));
  });

  test('falls back to the chat agent for emphasis', () async {
    final c = cubit();

    await c.load(projectRoot: '/p', chatAgentId: 'opencode');

    expect(c.state.chips.first.id, AgentProfileId.opencode);
    expect(c.state.chips.first.emphasized, isTrue);
  });
}

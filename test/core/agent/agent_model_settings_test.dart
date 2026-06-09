import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('AgentModelSettings', () {
    test('defaults pin Claude to Haiku 4.5 and Codex to GPT-5.3 Codex Spark',
        () {
      expect(
        AgentModelSettings.defaults.modelFor(AgentProfileId.claudeCode),
        'claude-haiku-4-5',
      );
      expect(
        AgentModelSettings.defaults.modelFor(AgentProfileId.codex),
        'gpt-5.3-codex-spark',
      );
      expect(
        AgentModelSettings.defaults.modelFor(AgentProfileId.opencode),
        isNull,
      );
    });

    test('presets expose the requested Codex models', () {
      final codex = AgentModelSettings.presets[AgentProfileId.codex]!;
      expect(
        codex.map((o) => o.slug),
        containsAll(<String>['gpt-5.3-codex-spark', 'gpt-5.4-mini']),
      );
    });
  });

  group('AgentModelSettingsRepository', () {
    test('returns default when unset and the override once set', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final prefs = await SharedPreferences.getInstance();
      final repo = AgentModelSettingsRepository(prefs);

      expect(repo.modelFor(AgentProfileId.claudeCode), 'claude-haiku-4-5');

      await repo.setModel(AgentProfileId.claudeCode, 'claude-opus-4-8');
      expect(repo.modelFor(AgentProfileId.claudeCode), 'claude-opus-4-8');

      // Clearing restores the PickForge default.
      await repo.setModel(AgentProfileId.claudeCode, null);
      expect(repo.modelFor(AgentProfileId.claudeCode), 'claude-haiku-4-5');
    });
  });
}

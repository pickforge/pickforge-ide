import 'package:injectable/injectable.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A selectable model for an agent — the CLI slug plus a human label.
class AgentModelOption {
  const AgentModelOption(this.slug, this.label);
  final String slug;
  final String label;
}

/// Per-agent model selection.
///
/// PickForge pins each agent to a fast, inexpensive model by default
/// (Claude → Haiku 4.5, Codex → GPT-5.3 Codex Spark). A null entry means
/// "use the agent CLI's own default" (no `--model` flag).
class AgentModelSettings {
  const AgentModelSettings(this.models);

  final Map<AgentProfileId, String?> models;

  String? modelFor(AgentProfileId id) => models[id];

  /// The PickForge default model per agent.
  static const Map<AgentProfileId, String?> defaultModels =
      <AgentProfileId, String?>{
    AgentProfileId.claudeCode: 'claude-haiku-4-5',
    AgentProfileId.codex: 'gpt-5.3-codex-spark',
    AgentProfileId.opencode: null,
    AgentProfileId.cursor: null,
    AgentProfileId.gemini: null,
  };

  /// Selectable presets per agent (the first entry is the PickForge default).
  static const Map<AgentProfileId, List<AgentModelOption>> presets =
      <AgentProfileId, List<AgentModelOption>>{
    AgentProfileId.claudeCode: [
      AgentModelOption('claude-haiku-4-5', 'Haiku 4.5'),
      AgentModelOption('claude-sonnet-4-6', 'Sonnet 4.6'),
      AgentModelOption('claude-opus-4-8', 'Opus 4.8'),
    ],
    AgentProfileId.codex: [
      AgentModelOption('gpt-5.3-codex-spark', 'GPT-5.3 Codex Spark'),
      AgentModelOption('gpt-5.4-mini', 'GPT-5.4 Mini'),
      AgentModelOption('gpt-5.5', 'GPT-5.5'),
    ],
  };

  static const AgentModelSettings defaults = AgentModelSettings(defaultModels);
}

@lazySingleton
class AgentModelSettingsRepository {
  AgentModelSettingsRepository(this._prefs);

  final SharedPreferences _prefs;

  String _key(AgentProfileId id) => 'agentModel.${id.value}';

  /// The model slug for [id] — the stored override, or the PickForge default.
  /// Reads synchronously so it can be used at PTY spawn time.
  String? modelFor(AgentProfileId id) =>
      _prefs.getString(_key(id)) ?? AgentModelSettings.defaultModels[id];

  AgentModelSettings load() {
    final models = <AgentProfileId, String?>{
      for (final id in AgentProfileId.values) id: modelFor(id),
    };
    return AgentModelSettings(models);
  }

  Future<void> setModel(AgentProfileId id, String? model) async {
    if (model == null || model.isEmpty) {
      await _prefs.remove(_key(id));
    } else {
      await _prefs.setString(_key(id), model);
    }
  }
}

import 'package:pickforge/core/agent/models.dart';

class HeadlessChatFeatureFlags {
  const HeadlessChatFeatureFlags({
    Map<AgentProfileId, bool> enabledByAgent = const {},
  }) : _enabledByAgent = enabledByAgent;

  const HeadlessChatFeatureFlags.fromEnvironment()
      : _enabledByAgent = const {
          AgentProfileId.claudeCode: bool.fromEnvironment(
            'PICKFORGE_HEADLESS_CLAUDE_CODE',
          ),
          AgentProfileId.codex: bool.fromEnvironment(
            'PICKFORGE_HEADLESS_CODEX',
          ),
          AgentProfileId.opencode: bool.fromEnvironment(
            'PICKFORGE_HEADLESS_OPENCODE',
          ),
        };

  final Map<AgentProfileId, bool> _enabledByAgent;

  bool enabled(AgentProfileId agentId) => _enabledByAgent[agentId] ?? false;
}

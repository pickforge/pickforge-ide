import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';

part 'forge_state.freezed.dart';

@freezed
abstract class ForgeState with _$ForgeState {
  const factory ForgeState({
    required SkillId skill,
    required AgentProfileId agentId,
    required String terminalId,
    required bool launching,
    required String? lastError,
  }) = _ForgeState;

  factory ForgeState.initial() => const ForgeState(
        skill: SkillId.editWidget,
        agentId: AgentProfileId.claudeCode,
        terminalId: 'ghostty',
        launching: false,
        lastError: null,
      );
}

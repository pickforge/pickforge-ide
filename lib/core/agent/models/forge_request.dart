import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/skills/models/skill_id.dart';

part 'forge_request.freezed.dart';
part 'forge_request.g.dart';

class _AgentProfileIdConverter
    implements JsonConverter<AgentProfileId, String> {
  const _AgentProfileIdConverter();
  @override
  AgentProfileId fromJson(String json) => AgentProfileId.fromValue(json);
  @override
  String toJson(AgentProfileId object) => object.value;
}

class _SkillIdConverter implements JsonConverter<SkillId, String> {
  const _SkillIdConverter();
  @override
  SkillId fromJson(String json) => SkillId.fromValue(json);
  @override
  String toJson(SkillId object) => object.value;
}

@freezed
abstract class ForgeRequest with _$ForgeRequest {
  const factory ForgeRequest({
    @_AgentProfileIdConverter() required AgentProfileId agentId,
    @_SkillIdConverter() required SkillId skill,
    required SelectedWidget widget,
    required String terminalId,
    required String projectRoot,
  }) = _ForgeRequest;

  factory ForgeRequest.fromJson(Map<String, dynamic> json) =>
      _$ForgeRequestFromJson(json);
}

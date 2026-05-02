// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'forge_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_ForgeRequest _$ForgeRequestFromJson(Map<String, dynamic> json) =>
    _ForgeRequest(
      agentId:
          const _AgentProfileIdConverter().fromJson(json['agentId'] as String),
      skill: const _SkillIdConverter().fromJson(json['skill'] as String),
      widget: SelectedWidget.fromJson(json['widget'] as Map<String, dynamic>),
      terminalId: json['terminalId'] as String,
      projectRoot: json['projectRoot'] as String,
    );

Map<String, dynamic> _$ForgeRequestToJson(_ForgeRequest instance) =>
    <String, dynamic>{
      'agentId': const _AgentProfileIdConverter().toJson(instance.agentId),
      'skill': const _SkillIdConverter().toJson(instance.skill),
      'widget': instance.widget.toJson(),
      'terminalId': instance.terminalId,
      'projectRoot': instance.projectRoot,
    };

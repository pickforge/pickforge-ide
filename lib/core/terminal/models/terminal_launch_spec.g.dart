// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'terminal_launch_spec.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_TerminalLaunchSpec _$TerminalLaunchSpecFromJson(Map<String, dynamic> json) =>
    _TerminalLaunchSpec(
      id: const _TerminalIdConverter().fromJson(json['id'] as String),
      scriptPath: json['scriptPath'] as String,
      workingDir: json['workingDir'] as String,
      env: Map<String, String>.from(json['env'] as Map),
    );

Map<String, dynamic> _$TerminalLaunchSpecToJson(_TerminalLaunchSpec instance) =>
    <String, dynamic>{
      'id': const _TerminalIdConverter().toJson(instance.id),
      'scriptPath': instance.scriptPath,
      'workingDir': instance.workingDir,
      'env': instance.env,
    };

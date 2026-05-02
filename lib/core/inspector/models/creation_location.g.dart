// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'creation_location.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CreationLocation _$CreationLocationFromJson(Map<String, dynamic> json) =>
    _CreationLocation(
      file: json['file'] as String,
      line: (json['line'] as num).toInt(),
      column: (json['column'] as num).toInt(),
    );

Map<String, dynamic> _$CreationLocationToJson(_CreationLocation instance) =>
    <String, dynamic>{
      'file': instance.file,
      'line': instance.line,
      'column': instance.column,
    };

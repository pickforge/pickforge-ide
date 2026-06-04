// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'rebuild_stats.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_RebuildStats _$RebuildStatsFromJson(Map<String, dynamic> json) =>
    _RebuildStats(
      frameNumber: (json['frameNumber'] as num?)?.toInt(),
      startTime: (json['startTime'] as num?)?.toInt(),
      widgets: (json['widgets'] as List<dynamic>)
          .map((e) => RebuiltWidget.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$RebuildStatsToJson(_RebuildStats instance) =>
    <String, dynamic>{
      'frameNumber': instance.frameNumber,
      'startTime': instance.startTime,
      'widgets': instance.widgets.map((e) => e.toJson()).toList(),
    };

_RebuiltWidget _$RebuiltWidgetFromJson(Map<String, dynamic> json) =>
    _RebuiltWidget(
      className: json['className'] as String,
      location:
          CreationLocation.fromJson(json['location'] as Map<String, dynamic>),
      count: (json['count'] as num).toInt(),
    );

Map<String, dynamic> _$RebuiltWidgetToJson(_RebuiltWidget instance) =>
    <String, dynamic>{
      'className': instance.className,
      'location': instance.location.toJson(),
      'count': instance.count,
    };

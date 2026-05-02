// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'selected_widget.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_SelectedWidget _$SelectedWidgetFromJson(Map<String, dynamic> json) =>
    _SelectedWidget(
      node: WidgetNode.fromJson(json['node'] as Map<String, dynamic>),
      ancestorClasses: (json['ancestorClasses'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
      sourceSnippet: json['sourceSnippet'] as String?,
      screenshotPath: json['screenshotPath'] as String?,
      adbScreenshotPath: json['adbScreenshotPath'] as String?,
      propertiesJson: json['propertiesJson'] as Map<String, dynamic>,
    );

Map<String, dynamic> _$SelectedWidgetToJson(_SelectedWidget instance) =>
    <String, dynamic>{
      'node': instance.node.toJson(),
      'ancestorClasses': instance.ancestorClasses,
      'sourceSnippet': instance.sourceSnippet,
      'screenshotPath': instance.screenshotPath,
      'adbScreenshotPath': instance.adbScreenshotPath,
      'propertiesJson': instance.propertiesJson,
    };

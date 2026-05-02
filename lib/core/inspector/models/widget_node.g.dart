// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'widget_node.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_WidgetNode _$WidgetNodeFromJson(Map<String, dynamic> json) => _WidgetNode(
      id: json['id'] as String,
      className: json['className'] as String,
      children: (json['children'] as List<dynamic>)
          .map((e) => WidgetNode.fromJson(e as Map<String, dynamic>))
          .toList(),
      creationLocation: json['creationLocation'] == null
          ? null
          : CreationLocation.fromJson(
              json['creationLocation'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$WidgetNodeToJson(_WidgetNode instance) =>
    <String, dynamic>{
      'id': instance.id,
      'className': instance.className,
      'children': instance.children.map((e) => e.toJson()).toList(),
      'creationLocation': instance.creationLocation?.toJson(),
    };

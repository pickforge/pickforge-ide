import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:pickforge/core/inspector/models/creation_location.dart';

part 'widget_node.g.dart';
part 'widget_node.freezed.dart';

@freezed
abstract class WidgetNode with _$WidgetNode {
  const factory WidgetNode({
    required String id,
    required String className,
    required List<WidgetNode> children,
    required CreationLocation? creationLocation,
  }) = _WidgetNode;

  factory WidgetNode.fromJson(Map<String, dynamic> json) =>
      _$WidgetNodeFromJson(json);

  const WidgetNode._();

  bool get isUserCode {
    final loc = creationLocation;
    if (loc == null) return false;
    return !loc.file.contains('/flutter/packages/flutter/');
  }
}

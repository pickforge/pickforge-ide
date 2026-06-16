import 'dart:ui';

import 'package:equatable/equatable.dart';

/// A coarse accessibility role inferred from an Android widget class name.
///
/// Deliberately approximate — it drives presentation, not source mapping.
enum ReactNativeA11yRole {
  button,
  text,
  image,
  input,
  switchControl,
  checkbox,
  list,
  unknown,
}

/// A node in the device-side UIAutomator accessibility hierarchy.
class ReactNativeA11yNode extends Equatable {
  const ReactNativeA11yNode({
    required this.nodeId,
    required this.role,
    required this.className,
    required this.bounds,
    required this.enabled,
    required this.clickable,
    required this.selected,
    this.text,
    this.contentDescription,
    this.resourceId,
    this.children = const [],
  });

  /// Stable index-path id within the parsed tree (e.g. `0`, `0/2/1`).
  final String nodeId;
  final ReactNativeA11yRole role;
  final String className;
  final String? text;
  final String? contentDescription;
  final String? resourceId;
  final Rect bounds;
  final bool enabled;
  final bool clickable;
  final bool selected;
  final List<ReactNativeA11yNode> children;

  @override
  List<Object?> get props => [
        nodeId,
        role,
        className,
        text,
        contentDescription,
        resourceId,
        bounds,
        enabled,
        clickable,
        selected,
        children,
      ];
}

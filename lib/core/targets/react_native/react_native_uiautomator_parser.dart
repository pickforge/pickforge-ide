import 'dart:ui';

import 'package:pickforge/core/targets/react_native/react_native_uiautomator_node.dart';
import 'package:xml/xml.dart';

/// Parses device-side UIAutomator XML into a [ReactNativeA11yNode] tree and
/// answers hit-test / ancestor queries against it.
///
/// Robust to malformed `bounds` (falls back to [Rect.zero]) and tolerant of the
/// status line `adb exec-out uiautomator dump /dev/tty` prepends.
class ReactNativeUiAutomatorParser {
  const ReactNativeUiAutomatorParser();

  static final _boundsPattern =
      RegExp(r'\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]');

  /// Parses [xml] into the root accessibility node.
  ///
  /// Throws [FormatException] when no `<node>` elements are present.
  ReactNativeA11yNode parse(String xml) {
    final document = XmlDocument.parse(_extractXml(xml));
    final topNodes =
        document.rootElement.findElements('node').toList(growable: false);
    if (topNodes.isEmpty) {
      throw const FormatException('No UIAutomator <node> elements found');
    }
    if (topNodes.length == 1) {
      return _toNode(topNodes.single, '0');
    }
    // Multiple top-level windows: wrap them under a synthetic root whose bounds
    // span every child, so hit-testing still reaches into the children.
    final children = <ReactNativeA11yNode>[];
    for (var i = 0; i < topNodes.length; i++) {
      children.add(_toNode(topNodes[i], '$i'));
    }
    // Union only the real (non-empty) child bounds; an off-screen window with
    // zero bounds must not pull the union toward the origin.
    final realBounds =
        children.map((c) => c.bounds).where((b) => !b.isEmpty).toList();
    var bounds = realBounds.isEmpty ? Rect.zero : realBounds.first;
    for (final b in realBounds.skip(1)) {
      bounds = bounds.expandToInclude(b);
    }
    return ReactNativeA11yNode(
      nodeId: 'root',
      role: ReactNativeA11yRole.unknown,
      className: 'hierarchy',
      bounds: bounds,
      enabled: true,
      clickable: false,
      selected: false,
      children: children,
    );
  }

  /// The deepest, topmost node whose bounds contain [devicePoint], or `null`.
  ReactNativeA11yNode? hitTest(ReactNativeA11yNode root, Offset devicePoint) {
    if (!root.bounds.contains(devicePoint)) return null;
    for (final child in root.children.reversed) {
      final hit = hitTest(child, devicePoint);
      if (hit != null) return hit;
    }
    return root;
  }

  /// The ancestors of [nodeId], ordered root → immediate parent (exclusive of
  /// the node itself). Empty when the node is the root or is not found.
  List<ReactNativeA11yNode> ancestorHierarchy(
    ReactNativeA11yNode root,
    String nodeId,
  ) {
    final path = <ReactNativeA11yNode>[];

    bool walk(ReactNativeA11yNode node) {
      if (node.nodeId == nodeId) return true;
      path.add(node);
      for (final child in node.children) {
        if (walk(child)) return true;
      }
      path.removeLast();
      return false;
    }

    return walk(root) ? List.unmodifiable(path) : const [];
  }

  ReactNativeA11yNode _toNode(XmlElement element, String nodeId) {
    final children = <ReactNativeA11yNode>[];
    final childElements = element.findElements('node').toList(growable: false);
    for (var i = 0; i < childElements.length; i++) {
      children.add(_toNode(childElements[i], '$nodeId/$i'));
    }
    final className = element.getAttribute('class') ?? '';
    return ReactNativeA11yNode(
      nodeId: nodeId,
      role: _role(className),
      className: className,
      text: _nonEmpty(element.getAttribute('text')),
      contentDescription: _nonEmpty(element.getAttribute('content-desc')),
      resourceId: _nonEmpty(element.getAttribute('resource-id')),
      bounds: _parseBounds(element.getAttribute('bounds')),
      enabled: element.getAttribute('enabled') == 'true',
      clickable: element.getAttribute('clickable') == 'true',
      selected: element.getAttribute('selected') == 'true',
      children: children,
    );
  }

  ReactNativeA11yRole _role(String className) {
    final c = className.toLowerCase();
    if (c.contains('button')) return ReactNativeA11yRole.button;
    if (c.contains('edittext')) return ReactNativeA11yRole.input;
    if (c.contains('image')) return ReactNativeA11yRole.image;
    if (c.contains('switch')) return ReactNativeA11yRole.switchControl;
    if (c.contains('checkbox')) return ReactNativeA11yRole.checkbox;
    if (c.contains('recyclerview') ||
        c.contains('listview') ||
        c.contains('scrollview')) {
      return ReactNativeA11yRole.list;
    }
    if (c.contains('textview')) return ReactNativeA11yRole.text;
    return ReactNativeA11yRole.unknown;
  }

  Rect _parseBounds(String? raw) {
    if (raw == null) return Rect.zero;
    final match = _boundsPattern.firstMatch(raw);
    if (match == null) return Rect.zero;
    final left = double.parse(match.group(1)!);
    final top = double.parse(match.group(2)!);
    final right = double.parse(match.group(3)!);
    final bottom = double.parse(match.group(4)!);
    return Rect.fromLTRB(left, top, right, bottom);
  }

  String? _nonEmpty(String? value) {
    if (value == null || value.isEmpty) return null;
    return value;
  }

  String _extractXml(String raw) {
    final start = raw.indexOf('<');
    final end = raw.lastIndexOf('>');
    if (start < 0 || end < start) return raw;
    return raw.substring(start, end + 1);
  }
}

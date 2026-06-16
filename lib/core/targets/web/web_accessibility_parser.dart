import 'dart:convert';

import 'package:equatable/equatable.dart';

/// A node in the browser accessibility tree, parsed from a CDP
/// `Accessibility.getFullAXTree` result.
class WebAxNode extends Equatable {
  const WebAxNode({
    required this.nodeId,
    required this.role,
    this.name,
    this.value,
    this.backendDomNodeId,
    this.ignored = false,
    this.children = const [],
  });

  final String nodeId;
  final String role;
  final String? name;
  final String? value;

  /// The backing DOM node id (for cross-referencing DOM/box-model later).
  final int? backendDomNodeId;
  final bool ignored;
  final List<WebAxNode> children;

  @override
  List<Object?> get props =>
      [nodeId, role, name, value, backendDomNodeId, ignored, children];
}

/// Parses a CDP `Accessibility.getFullAXTree` payload into a [WebAxNode] tree
/// and answers find / ancestor-path queries.
///
/// Framework-agnostic and fixture-testable: the live `getFullAXTree` call is a
/// browser-side CDP request, but its JSON shape is parsed here without a live
/// browser. Tolerant: malformed JSON or an empty node list yields `null`, and
/// cyclic `childIds` are truncated rather than looped.
class WebAccessibilityParser {
  const WebAccessibilityParser();

  WebAxNode? parse(String json) {
    final Object? decoded;
    try {
      decoded = jsonDecode(json);
    } on FormatException {
      return null;
    }
    final nodes = decoded is Map<String, Object?> ? decoded['nodes'] : decoded;
    if (nodes is! List) return null;

    final raw = <String, Map<String, Object?>>{};
    final childIds = <String, List<String>>{};
    final referenced = <String>{};
    for (final node in nodes.whereType<Map<String, Object?>>()) {
      final id = node['nodeId']?.toString();
      if (id == null) continue;
      raw[id] = node;
      final rawIds = node['childIds'];
      final ids = rawIds is List
          ? rawIds.map((c) => c.toString()).toList(growable: false)
          : const <String>[];
      childIds[id] = ids;
      referenced.addAll(ids);
    }
    if (raw.isEmpty) return null;

    // A well-formed AX tree has a single unreferenced `RootWebArea`. Prefer it,
    // fall back to the first unreferenced node, then to the first node.
    final unreferenced =
        raw.keys.where((id) => !referenced.contains(id)).toList();
    final rootId = unreferenced.firstWhere(
      (id) => _field(raw[id]?['role']) == 'RootWebArea',
      orElse: () =>
          unreferenced.isNotEmpty ? unreferenced.first : raw.keys.first,
    );
    return _build(rootId, raw, childIds, <String>{});
  }

  /// The ancestors of [nodeId], root → immediate parent (exclusive). Empty when
  /// the node is the root or is not found.
  List<WebAxNode> ancestorPath(WebAxNode root, String nodeId) {
    final path = <WebAxNode>[];
    bool walk(WebAxNode node) {
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

  WebAxNode? findById(WebAxNode root, String nodeId) {
    if (root.nodeId == nodeId) return root;
    for (final child in root.children) {
      final found = findById(child, nodeId);
      if (found != null) return found;
    }
    return null;
  }

  WebAxNode _build(
    String id,
    Map<String, Map<String, Object?>> raw,
    Map<String, List<String>> childIds,
    Set<String> seen,
  ) {
    seen.add(id);
    final node = raw[id]!;
    final children = <WebAxNode>[];
    for (final childId in childIds[id] ?? const <String>[]) {
      // Guard against cyclic childIds.
      if (raw.containsKey(childId) && !seen.contains(childId)) {
        children.add(_build(childId, raw, childIds, seen));
      }
    }
    return WebAxNode(
      nodeId: id,
      role: _field(node['role']) ?? '',
      name: _field(node['name']),
      value: _field(node['value']),
      backendDomNodeId: (node['backendDOMNodeId'] as num?)?.toInt(),
      ignored: node['ignored'] == true,
      children: children,
    );
  }

  /// CDP wraps these as `{type, value}`; pull the `value`.
  String? _field(Object? wrapped) {
    if (wrapped is Map && wrapped['value'] != null) {
      return wrapped['value'].toString();
    }
    return null;
  }
}

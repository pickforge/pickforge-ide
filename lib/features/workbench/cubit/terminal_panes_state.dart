import 'package:equatable/equatable.dart';
import 'package:flutter/widgets.dart';

enum PaneSplitDirection { left, right, up, down }

extension PaneSplitDirectionAxis on PaneSplitDirection {
  Axis get axis => switch (this) {
        PaneSplitDirection.left || PaneSplitDirection.right => Axis.horizontal,
        PaneSplitDirection.up || PaneSplitDirection.down => Axis.vertical,
      };

  /// True when the new pane lands before the target (left/up).
  bool get insertBefore =>
      this == PaneSplitDirection.left || this == PaneSplitDirection.up;
}

sealed class PaneNode extends Equatable {
  const PaneNode();

  String get id;
}

class PaneLeaf extends PaneNode {
  const PaneLeaf({required this.id, required this.name});

  @override
  final String id;

  /// Short person-style callsign shown in the pane header.
  final String name;

  @override
  List<Object?> get props => [id, name];
}

class PaneSplit extends PaneNode {
  const PaneSplit({
    required this.id,
    required this.axis,
    required this.children,
  });

  @override
  final String id;
  final Axis axis;
  final List<PaneNode> children;

  @override
  List<Object?> get props => [id, axis, children];
}

class TerminalPanesState extends Equatable {
  const TerminalPanesState({
    required this.root,
    required this.focusedPaneId,
    this.fullscreenPaneId,
  });

  final PaneNode root;
  final String focusedPaneId;
  final String? fullscreenPaneId;

  List<PaneLeaf> get leaves => collectPaneLeaves(root);

  PaneLeaf? leaf(String id) => leaves.where((l) => l.id == id).firstOrNull;

  TerminalPanesState copyWith({
    PaneNode? root,
    String? focusedPaneId,
    String? Function()? fullscreenPaneId,
  }) =>
      TerminalPanesState(
        root: root ?? this.root,
        focusedPaneId: focusedPaneId ?? this.focusedPaneId,
        fullscreenPaneId: fullscreenPaneId != null
            ? fullscreenPaneId()
            : this.fullscreenPaneId,
      );

  @override
  List<Object?> get props => [root, focusedPaneId, fullscreenPaneId];
}

List<PaneLeaf> collectPaneLeaves(PaneNode node) => switch (node) {
      PaneLeaf() => [node],
      PaneSplit(:final children) => [
          for (final child in children) ...collectPaneLeaves(child),
        ],
    };

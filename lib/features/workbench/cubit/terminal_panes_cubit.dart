import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';

/// Short person-style callsigns for terminal panes, in hand-shuffled order so
/// consecutive panes don't read alphabetically.
const paneCallsigns = [
  'Mae',
  'Gus',
  'Ivy',
  'Rex',
  'Ada',
  'Bo',
  'Tess',
  'Kai',
  'Dot',
  'Eli',
  'Pia',
  'Hal',
  'Sky',
  'Lou',
  'Cy',
  'Fay',
  'Ned',
  'Quin',
  'Oz',
  'Jo',
];

/// Keeps each chat's pane layout alive across widget remounts (switching
/// chats, fullscreen) for the lifetime of the app session.
@lazySingleton
class TerminalPaneLayoutStore {
  final _layouts = <String, TerminalPanesState>{};

  TerminalPanesState? restore(String chatId) => _layouts[chatId];

  void save(String chatId, TerminalPanesState state) =>
      _layouts[chatId] = state;
}

class TerminalPanesCubit extends Cubit<TerminalPanesState> {
  TerminalPanesCubit({required this.chatId, TerminalPaneLayoutStore? store})
      : _store = store,
        super(
          store?.restore(chatId) ??
              TerminalPanesState(
                root: PaneLeaf(id: 'main', name: paneCallsigns.first),
                focusedPaneId: 'main',
              ),
        );

  final String chatId;
  final TerminalPaneLayoutStore? _store;
  var _paneCounter = 0;

  void focusPane(String paneId) {
    if (state.leaf(paneId) == null || state.focusedPaneId == paneId) return;
    _emit(state.copyWith(focusedPaneId: paneId));
  }

  /// Opens a new shell next to [targetPaneId] in [direction].
  void split(String targetPaneId, PaneSplitDirection direction) {
    if (state.leaf(targetPaneId) == null) return;
    final leaf = PaneLeaf(id: _nextPaneId(), name: _nextName());
    final root = _insert(state.root, targetPaneId, leaf, direction);
    _emit(
      state.copyWith(
        root: root,
        focusedPaneId: leaf.id,
        fullscreenPaneId: () => null,
      ),
    );
  }

  /// Removes a pane. The last remaining pane cannot be closed.
  void closePane(String paneId) {
    if (state.leaves.length <= 1 || state.leaf(paneId) == null) return;
    final root = _remove(state.root, paneId)!;
    final leaves = collectPaneLeaves(root);
    _emit(
      TerminalPanesState(
        root: root,
        focusedPaneId: state.focusedPaneId == paneId ||
                leaves.every((l) => l.id != state.focusedPaneId)
            ? leaves.first.id
            : state.focusedPaneId,
        fullscreenPaneId:
            state.fullscreenPaneId == paneId ? null : state.fullscreenPaneId,
      ),
    );
  }

  /// Docks an existing pane onto [targetPaneId]'s [direction] edge.
  void move(
    String draggedPaneId,
    String targetPaneId,
    PaneSplitDirection direction,
  ) {
    if (draggedPaneId == targetPaneId) return;
    final dragged = state.leaf(draggedPaneId);
    if (dragged == null || state.leaf(targetPaneId) == null) return;
    if (state.leaves.length <= 1) return;
    final without = _remove(state.root, draggedPaneId)!;
    final root = _insert(without, targetPaneId, dragged, direction);
    _emit(
      state.copyWith(
        root: root,
        focusedPaneId: draggedPaneId,
        fullscreenPaneId: () => null,
      ),
    );
  }

  void toggleFullscreen(String paneId) {
    if (state.leaf(paneId) == null) return;
    _emit(
      state.copyWith(
        focusedPaneId: paneId,
        fullscreenPaneId: () =>
            state.fullscreenPaneId == paneId ? null : paneId,
      ),
    );
  }

  void _emit(TerminalPanesState next) {
    _store?.save(chatId, next);
    emit(next);
  }

  String _nextPaneId() {
    final used = state.leaves.map((l) => l.id).toSet();
    var id = 'pane-${++_paneCounter}';
    while (used.contains(id)) {
      id = 'pane-${++_paneCounter}';
    }
    return id;
  }

  String _nextName() {
    final used = state.leaves.map((l) => l.name).toSet();
    for (final name in paneCallsigns) {
      if (!used.contains(name)) return name;
    }
    var round = 2;
    while (true) {
      for (final name in paneCallsigns) {
        final candidate = '$name $round';
        if (!used.contains(candidate)) return candidate;
      }
      round++;
    }
  }

  PaneNode _insert(
    PaneNode node,
    String targetId,
    PaneLeaf pane,
    PaneSplitDirection direction,
  ) {
    switch (node) {
      case PaneLeaf():
        if (node.id != targetId) return node;
        final children = direction.insertBefore ? [pane, node] : [node, pane];
        return PaneSplit(
          id: 'split-${pane.id}',
          axis: direction.axis,
          children: children,
        );
      case PaneSplit(:final axis, :final children):
        final index = children.indexWhere((c) => c.id == targetId);
        if (index >= 0 && axis == direction.axis) {
          // Same axis: slot the new pane next to the target directly.
          final next = [...children]
            ..insert(direction.insertBefore ? index : index + 1, pane);
          return PaneSplit(id: node.id, axis: axis, children: next);
        }
        return PaneSplit(
          id: node.id,
          axis: axis,
          children: [
            for (final child in children)
              _insert(child, targetId, pane, direction),
          ],
        );
    }
  }

  /// Removes [paneId]; collapses single-child splits. Null when [node] itself
  /// is the removed leaf.
  PaneNode? _remove(PaneNode node, String paneId) {
    switch (node) {
      case PaneLeaf():
        return node.id == paneId ? null : node;
      case PaneSplit(:final axis, :final children):
        final next = [
          for (final child in children)
            if (_remove(child, paneId) case final kept?) kept,
        ];
        if (next.length == 1) return next.single;
        if (next.isEmpty) return null;
        return PaneSplit(id: node.id, axis: axis, children: next);
    }
  }
}

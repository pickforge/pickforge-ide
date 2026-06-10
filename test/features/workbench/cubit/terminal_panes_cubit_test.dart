import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_cubit.dart';
import 'package:pickforge/features/workbench/cubit/terminal_panes_state.dart';

void main() {
  TerminalPanesCubit cubit({TerminalPaneLayoutStore? store}) =>
      TerminalPanesCubit(chatId: 'chat-1', store: store);

  test('starts with a single named pane that is focused', () {
    final c = cubit();
    expect(c.state.leaves, hasLength(1));
    expect(c.state.leaves.single.id, 'main');
    expect(c.state.leaves.single.name, paneCallsigns.first);
    expect(c.state.focusedPaneId, 'main');
  });

  test('split right creates a horizontal pair, new pane after and focused', () {
    final c = cubit()..split('main', PaneSplitDirection.right);

    final root = c.state.root as PaneSplit;
    expect(root.axis, Axis.horizontal);
    expect(root.children.first.id, 'main');
    final newPane = root.children.last as PaneLeaf;
    expect(newPane.name, isNot(paneCallsigns.first));
    expect(c.state.focusedPaneId, newPane.id);
  });

  test('split up places the new pane before the target vertically', () {
    final c = cubit()..split('main', PaneSplitDirection.up);

    final root = c.state.root as PaneSplit;
    expect(root.axis, Axis.vertical);
    expect(root.children.last.id, 'main');
  });

  test('splitting along the same axis extends the row instead of nesting', () {
    final c = cubit()
      ..split('main', PaneSplitDirection.right)
      ..split('main', PaneSplitDirection.right);

    final root = c.state.root as PaneSplit;
    expect(root.children, hasLength(3));
    expect(root.children.first.id, 'main');
  });

  test('splitting across the axis nests a new split', () {
    final c = cubit()
      ..split('main', PaneSplitDirection.right)
      ..split('main', PaneSplitDirection.down);

    final root = c.state.root as PaneSplit;
    expect(root.axis, Axis.horizontal);
    final nested = root.children.first as PaneSplit;
    expect(nested.axis, Axis.vertical);
    expect(nested.children.first.id, 'main');
    expect(c.state.leaves, hasLength(3));
  });

  test('pane names never repeat', () {
    final c = cubit();
    for (var i = 0; i < 25; i++) {
      c.split('main', PaneSplitDirection.right);
    }
    final names = c.state.leaves.map((l) => l.name).toList();
    expect(names.toSet().length, names.length);
  });

  test('close removes the pane and collapses the empty split', () {
    final c = cubit()..split('main', PaneSplitDirection.right);
    final added = c.state.leaves.last.id;

    c.closePane(added);

    expect(c.state.root, isA<PaneLeaf>());
    expect(c.state.leaves.single.id, 'main');
    expect(c.state.focusedPaneId, 'main');
  });

  test('the last pane cannot be closed', () {
    final c = cubit()..closePane('main');
    expect(c.state.leaves, hasLength(1));
  });

  test('closing the fullscreen pane exits fullscreen', () {
    final c = cubit()..split('main', PaneSplitDirection.right);
    final added = c.state.leaves.last.id;
    c
      ..toggleFullscreen(added)
      ..closePane(added);

    expect(c.state.fullscreenPaneId, isNull);
  });

  test('move docks an existing pane onto another edge', () {
    final c = cubit()..split('main', PaneSplitDirection.right);
    final added = c.state.leaves.last.id;

    c.move(added, 'main', PaneSplitDirection.up);

    final root = c.state.root as PaneSplit;
    expect(root.axis, Axis.vertical);
    expect(root.children.first.id, added);
    expect(root.children.last.id, 'main');
    expect(c.state.focusedPaneId, added);
  });

  test('toggleFullscreen flips and focuses', () {
    final c = cubit()
      ..split('main', PaneSplitDirection.right)
      ..toggleFullscreen('main');
    expect(c.state.fullscreenPaneId, 'main');
    expect(c.state.focusedPaneId, 'main');

    c.toggleFullscreen('main');

    expect(c.state.fullscreenPaneId, isNull);
  });

  test('layout store restores the tree for the same chat', () {
    final store = TerminalPaneLayoutStore();
    cubit(store: store).split('main', PaneSplitDirection.right);

    final restored = cubit(store: store);

    expect(restored.state.leaves, hasLength(2));
  });
}

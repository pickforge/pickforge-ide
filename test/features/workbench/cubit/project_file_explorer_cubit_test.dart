import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_state.dart';

void main() {
  test('load emits scanned nodes', () async {
    final scanner = _FakeScanner([
      const ProjectFileNode(
        path: '/app/lib',
        relativePath: 'lib',
        name: 'lib',
        isDirectory: true,
      ),
    ]);
    final cubit = ProjectFileExplorerCubit(
      projectRoot: '/app',
      scanner: scanner,
      opener: _FakeOpener(),
    );

    await cubit.load();

    expect(cubit.state.status, ProjectFileExplorerStatus.ready);
    expect(cubit.state.nodes.single.name, 'lib');
  });

  test('toggleExpanded tracks expanded paths', () {
    final cubit = ProjectFileExplorerCubit(
      projectRoot: '/app',
      scanner: _FakeScanner(const []),
      opener: _FakeOpener(),
    )..toggleExpanded('/app/lib');

    expect(cubit.state.expandedPaths, {'/app/lib'});
  });
}

class _FakeScanner implements ProjectFileTreeScanner {
  _FakeScanner(this.nodes);

  final List<ProjectFileNode> nodes;

  @override
  int get maxDepth => 8;

  @override
  int get maxEntriesPerDirectory => 300;

  @override
  Future<List<ProjectFileNode>> scan(
    String projectRoot, {
    bool showHidden = false,
  }) async =>
      nodes;
}

class _FakeOpener implements ProjectFileOpener {
  @override
  Future<void> open(String path) async {}

  @override
  Future<void> reveal(String path) async {}
}

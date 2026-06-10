import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
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
      rootExists: (_) => true,
    );

    await cubit.load();

    expect(cubit.state.status, ProjectFileExplorerStatus.ready);
    expect(cubit.state.nodes.single.name, 'lib');
  });

  test('load reports a missing project root instead of an empty tree',
      () async {
    final cubit = ProjectFileExplorerCubit(
      projectRoot: '/gone',
      scanner: _FakeScanner(const []),
      opener: _FakeOpener(),
      rootExists: (_) => false,
    );

    await cubit.load();

    expect(cubit.state.status, ProjectFileExplorerStatus.missingRoot);
    expect(cubit.state.error, '/gone');
  });

  test('load records scan performance counter', () async {
    final diagnostics = DiagnosticsService(_FakeRunner());
    final cubit = ProjectFileExplorerCubit(
      projectRoot: '/app',
      scanner: _FakeScanner(const []),
      opener: _FakeOpener(),
      diagnostics: diagnostics,
      rootExists: (_) => true,
    );

    await cubit.load();

    expect(diagnostics.performanceCounters, hasLength(1));
    expect(diagnostics.performanceCounters.single.name, 'fileExplorer.scan');
    expect(diagnostics.performanceCounters.single.sampleCount, 1);
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

class _FakeRunner implements ProcessRunner {
  @override
  Future<ProcessResult> run(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) async =>
      ProcessResult(1, 0, '', '');

  @override
  Future<RunningProcess> spawn(
    String executable,
    List<String> arguments, {
    String? cwd,
    Map<String, String>? env,
  }) {
    throw UnimplementedError();
  }
}

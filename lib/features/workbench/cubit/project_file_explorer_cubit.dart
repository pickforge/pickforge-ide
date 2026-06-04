import 'dart:async';
import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_state.dart';

class ProjectFileExplorerCubit extends Cubit<ProjectFileExplorerState> {
  ProjectFileExplorerCubit({
    required String projectRoot,
    required ProjectFileTreeScanner scanner,
    required ProjectFileOpener opener,
    DiagnosticsService? diagnostics,
  })  : _projectRoot = projectRoot,
        _scanner = scanner,
        _opener = opener,
        _diagnostics = diagnostics,
        super(const ProjectFileExplorerState());

  final String _projectRoot;
  final ProjectFileTreeScanner _scanner;
  final ProjectFileOpener _opener;
  final DiagnosticsService? _diagnostics;
  StreamSubscription<FileSystemEvent>? _watchSubscription;
  Timer? _reloadDebounce;

  Future<void> load() async {
    emit(state.copyWith(status: ProjectFileExplorerStatus.loading));
    final stopwatch = Stopwatch()..start();
    try {
      final nodes = await _scanner.scan(
        _projectRoot,
        showHidden: state.showHidden,
      );
      stopwatch.stop();
      _diagnostics?.recordPerformance('fileExplorer.scan', stopwatch.elapsed);
      if (isClosed) return;
      emit(
        state.copyWith(
          status: ProjectFileExplorerStatus.ready,
          nodes: nodes,
        ),
      );
    } on Object catch (error) {
      stopwatch.stop();
      _diagnostics?.recordPerformance('fileExplorer.scan', stopwatch.elapsed);
      if (isClosed) return;
      emit(
        state.copyWith(
          status: ProjectFileExplorerStatus.error,
          error: error.toString(),
        ),
      );
    }
  }

  void setQuery(String query) {
    emit(state.copyWith(query: query));
  }

  Future<void> toggleHidden() async {
    emit(state.copyWith(showHidden: !state.showHidden));
    await load();
  }

  Future<void> watch() async {
    await _watchSubscription?.cancel();
    try {
      _watchSubscription = Directory(_projectRoot)
          .watch(recursive: true)
          .listen((_) => _scheduleReload());
    } on Object {
      _watchSubscription = null;
    }
  }

  void toggleExpanded(String path) {
    final next = {...state.expandedPaths};
    if (!next.remove(path)) next.add(path);
    emit(state.copyWith(expandedPaths: next));
  }

  Future<void> open(String path) => _opener.open(path);

  Future<void> reveal(String path) => _opener.reveal(path);

  void _scheduleReload() {
    _reloadDebounce?.cancel();
    _reloadDebounce = Timer(const Duration(milliseconds: 300), () {
      if (!isClosed) unawaited(load());
    });
  }

  @override
  Future<void> close() async {
    _reloadDebounce?.cancel();
    await _watchSubscription?.cancel();
    return super.close();
  }
}

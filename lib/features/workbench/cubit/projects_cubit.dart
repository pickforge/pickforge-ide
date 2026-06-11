import 'dart:io';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:logging/logging.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

final _log = Logger('projects');

@injectable
class ProjectsCubit extends Cubit<ProjectsState> {
  ProjectsCubit(this._repo) : super(const ProjectsInitial());

  final ProjectsRepository _repo;

  Future<void> load() async {
    final priorActive = switch (state) {
      ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
      _ => null,
    };
    emit(const ProjectsLoading());
    try {
      final ready = await _readyState(preferredActive: priorActive);
      if (ready.missingRoots.isNotEmpty) {
        _log.warning(
          'project folders missing: ${ready.missingRoots.join(', ')}',
        );
      }
      emit(ready);
    } on Object catch (e) {
      _log.severe('loading projects failed', e);
      emit(ProjectsError(e.toString()));
    }
  }

  /// Switching projects keeps every pooled terminal alive: agents working in
  /// background projects must keep running (and be able to raise attention)
  /// while the user looks elsewhere.
  Future<void> selectProject(String projectRoot) async {
    if (state is! ProjectsReady) return;
    final ready = state as ProjectsReady;
    await _repo.touch(projectRoot);
    emit(ready.copyWith(activeProjectRoot: projectRoot));
  }

  /// Registers a folder as a project. Returns an error message on failure
  /// instead of entering a dead-end error state: the workspace must stay
  /// usable, the caller surfaces the message transiently.
  Future<String?> add(String rawPath) async {
    try {
      final added = await _repo.add(rawPath);
      _log.info('project added: ${added.projectRoot}');
      emit(await _readyState(preferredActive: added.projectRoot));
      return null;
    } on ProjectAddError catch (e) {
      _log.warning('adding project failed: ${e.message}');
      await load();
      return e.message;
    } on Object catch (e) {
      _log.severe('adding project failed', e);
      await load();
      return e.toString();
    }
  }

  Future<void> rename(String projectRoot, String displayName) async {
    await _repo.rename(projectRoot, displayName);
    await load();
  }

  Future<void> remove(String projectRoot) async {
    _log.info('project removed: $projectRoot');
    await _repo.remove(projectRoot);
    await load();
  }

  Future<void> archive(String projectRoot) async {
    _log.info('project archived: $projectRoot');
    await _repo.archive(projectRoot);
    final priorActive = switch (state) {
      ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
      _ => null,
    };
    emit(
      await _readyState(
        preferredActive: priorActive == projectRoot ? null : priorActive,
      ),
    );
  }

  Future<void> restoreProject(String projectRoot) async {
    await _repo.restore(projectRoot);
    await load();
  }

  /// Re-points a project whose folder moved on disk. Returns an error
  /// message on failure.
  Future<String?> relocate(String oldRoot, String newPath) async {
    try {
      await _repo.relocate(oldRoot, newPath);
      _log.info('project relocated: $oldRoot -> $newPath');
      await load();
      return null;
    } on ProjectAddError catch (e) {
      _log.warning('relocating $oldRoot failed: ${e.message}');
      return e.message;
    }
  }

  Future<ProjectsReady> _readyState({String? preferredActive}) async {
    final rows = await _repo.list();
    final archived = await _repo.archivedProjects();
    final active = preferredActive != null &&
            rows.any((r) => r.projectRoot == preferredActive)
        ? preferredActive
        : (rows.isNotEmpty ? rows.first.projectRoot : null);
    return ProjectsReady(
      projects: rows,
      activeProjectRoot: active,
      archivedProjects: archived,
      missingRoots: {
        for (final row in rows)
          if (!Directory(row.projectRoot).existsSync()) row.projectRoot,
      },
    );
  }
}

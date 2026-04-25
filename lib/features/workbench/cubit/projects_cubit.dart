import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';

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
      final rows = await _repo.list();
      final defaultActive =
          priorActive ?? (rows.isNotEmpty ? rows.first.projectRoot : null);
      emit(
        ProjectsReady(projects: rows, activeProjectRoot: defaultActive),
      );
    } on Object catch (e) {
      emit(ProjectsError(e.toString()));
    }
  }

  Future<void> selectProject(String projectRoot) async {
    if (state is! ProjectsReady) return;
    final ready = state as ProjectsReady;
    await _repo.touch(projectRoot);
    emit(ready.copyWith(activeProjectRoot: projectRoot));
  }

  Future<void> add(String rawPath) async {
    emit(const ProjectsLoading());
    try {
      final added = await _repo.add(rawPath);
      final rows = await _repo.list();
      emit(
        ProjectsReady(projects: rows, activeProjectRoot: added.projectRoot),
      );
    } on Object catch (e) {
      emit(ProjectsError(e.toString()));
    }
  }

  Future<void> rename(String projectRoot, String displayName) async {
    await _repo.rename(projectRoot, displayName);
    await load();
  }

  Future<void> remove(String projectRoot) async {
    await _repo.remove(projectRoot);
    await load();
  }
}

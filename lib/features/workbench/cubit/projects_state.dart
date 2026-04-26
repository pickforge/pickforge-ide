import 'package:equatable/equatable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

sealed class ProjectsState extends Equatable {
  const ProjectsState();

  @override
  List<Object?> get props => [];
}

class ProjectsInitial extends ProjectsState {
  const ProjectsInitial();
}

class ProjectsLoading extends ProjectsState {
  const ProjectsLoading();
}

class ProjectsReady extends ProjectsState {
  const ProjectsReady({required this.projects, this.activeProjectRoot});

  final List<ProjectRow> projects;
  final String? activeProjectRoot;

  ProjectsReady copyWith({
    List<ProjectRow>? projects,
    String? activeProjectRoot,
  }) =>
      ProjectsReady(
        projects: projects ?? this.projects,
        activeProjectRoot: activeProjectRoot ?? this.activeProjectRoot,
      );

  @override
  List<Object?> get props => [projects, activeProjectRoot];
}

class ProjectsError extends ProjectsState {
  const ProjectsError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

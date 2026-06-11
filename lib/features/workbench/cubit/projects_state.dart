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
  const ProjectsReady({
    required this.projects,
    this.activeProjectRoot,
    this.archivedProjects = const [],
    this.missingRoots = const {},
  });

  final List<ProjectRow> projects;
  final String? activeProjectRoot;

  /// Archived projects — hidden from the workspace, managed from Settings.
  final List<ProjectRow> archivedProjects;

  /// Roots whose folder no longer exists on disk (moved or deleted outside
  /// the app). The UI prompts to relocate or remove; nothing may recreate
  /// these directories.
  final Set<String> missingRoots;

  ProjectsReady copyWith({
    List<ProjectRow>? projects,
    String? activeProjectRoot,
    List<ProjectRow>? archivedProjects,
    Set<String>? missingRoots,
  }) =>
      ProjectsReady(
        projects: projects ?? this.projects,
        activeProjectRoot: activeProjectRoot ?? this.activeProjectRoot,
        archivedProjects: archivedProjects ?? this.archivedProjects,
        missingRoots: missingRoots ?? this.missingRoots,
      );

  @override
  List<Object?> get props =>
      [projects, activeProjectRoot, archivedProjects, missingRoots];
}

class ProjectsError extends ProjectsState {
  const ProjectsError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}

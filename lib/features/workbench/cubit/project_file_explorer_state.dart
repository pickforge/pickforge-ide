import 'package:equatable/equatable.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';

enum ProjectFileExplorerStatus { initial, loading, ready, missingRoot, error }

class ProjectFileExplorerState extends Equatable {
  const ProjectFileExplorerState({
    this.status = ProjectFileExplorerStatus.initial,
    this.nodes = const [],
    this.expandedPaths = const {},
    this.query = '',
    this.showHidden = false,
    this.error,
  });

  final ProjectFileExplorerStatus status;
  final List<ProjectFileNode> nodes;
  final Set<String> expandedPaths;
  final String query;
  final bool showHidden;
  final String? error;

  ProjectFileExplorerState copyWith({
    ProjectFileExplorerStatus? status,
    List<ProjectFileNode>? nodes,
    Set<String>? expandedPaths,
    String? query,
    bool? showHidden,
    String? error,
  }) =>
      ProjectFileExplorerState(
        status: status ?? this.status,
        nodes: nodes ?? this.nodes,
        expandedPaths: expandedPaths ?? this.expandedPaths,
        query: query ?? this.query,
        showHidden: showHidden ?? this.showHidden,
        error: error,
      );

  @override
  List<Object?> get props => [
        status,
        nodes,
        expandedPaths,
        query,
        showHidden,
        error,
      ];
}

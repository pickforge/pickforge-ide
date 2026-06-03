import 'package:equatable/equatable.dart';

class ProjectFileNode extends Equatable {
  const ProjectFileNode({
    required this.path,
    required this.relativePath,
    required this.name,
    required this.isDirectory,
    this.children = const [],
  });

  final String path;
  final String relativePath;
  final String name;
  final bool isDirectory;
  final List<ProjectFileNode> children;

  @override
  List<Object?> get props => [path, relativePath, name, isDirectory, children];
}

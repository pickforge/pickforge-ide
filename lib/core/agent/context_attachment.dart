import 'package:equatable/equatable.dart';

class ContextAttachment extends Equatable {
  const ContextAttachment({
    required this.path,
    required this.relativePath,
    required this.byteLength,
  });

  final String path;
  final String relativePath;
  final int byteLength;

  String get name {
    final normalized = relativePath.replaceAll(r'\', '/');
    final slash = normalized.lastIndexOf('/');
    return slash == -1 ? normalized : normalized.substring(slash + 1);
  }

  @override
  List<Object?> get props => [path, relativePath, byteLength];
}

import 'package:path/path.dart' as p;
import 'package:pickforge/core/inspector/creation_location_paths.dart';
import 'package:pickforge/core/inspector/models/selected_widget.dart';

class ForgeEligibilityPolicy {
  const ForgeEligibilityPolicy({
    this.allowedRootRelativePrefixes = const ['lib/'],
  });

  final List<String> allowedRootRelativePrefixes;

  bool canForge(SelectedWidget selection, String projectRoot) {
    final file = selection.node.creationLocation?.file.trim();
    if (file == null || file.isEmpty) return false;
    if (_isFrameworkPath(file)) return false;

    final root = p.normalize(p.absolute(projectRoot));
    final localFile = creationLocationFilePath(file);
    if (localFile == null || _isFrameworkPath(localFile)) return false;
    final absoluteFile = _resolveFile(root, localFile);
    if (absoluteFile == null) return false;
    if (absoluteFile != root && !p.isWithin(root, absoluteFile)) return false;

    final relative = p.relative(absoluteFile, from: root).replaceAll(r'\', '/');
    return allowedRootRelativePrefixes.any((prefix) {
      final normalized = prefix.replaceAll(r'\', '/');
      if (normalized.endsWith('/')) return relative.startsWith(normalized);
      return relative == normalized || relative.startsWith('$normalized/');
    });
  }

  bool _isFrameworkPath(String file) {
    final normalized = file.replaceAll(r'\', '/');
    return normalized.startsWith('dart:') ||
        normalized.startsWith('package:flutter/') ||
        normalized.contains('/flutter/packages/flutter/');
  }

  String? _resolveFile(String projectRoot, String file) {
    if (file.startsWith('package:')) return null;
    final joined = p.isAbsolute(file) ? file : p.join(projectRoot, file);
    return p.normalize(p.absolute(joined));
  }
}

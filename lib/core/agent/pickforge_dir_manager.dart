import 'dart:io';

/// Thrown when `.pickforge/` exists but lacks our `.gitignore` marker,
/// indicating a potential conflict with a user-managed directory.
class PickforgeDirConflictException implements Exception {
  const PickforgeDirConflictException(this.message);
  final String message;

  @override
  String toString() => 'PickforgeDirConflictException: $message';
}

/// Manages the `.pickforge/` folder in a target project.
///
/// Creates the directory with a `.gitignore` that ignores everything,
/// and writes per-session context files.
class PickforgeDirManager {
  static const _gitignoreContent = '*\n';
  static const _dirName = '.pickforge';

  /// Ensures `.pickforge/` exists with our `.gitignore` marker.
  ///
  /// Creates the directory if missing. If it exists without our `.gitignore`,
  /// throws [PickforgeDirConflictException].
  Future<void> ensure({required String projectRoot}) async {
    final pickforgeDir = Directory('$projectRoot/$_dirName');
    final gitignoreFile = File('${pickforgeDir.path}/.gitignore');

    if (pickforgeDir.existsSync()) {
      if (gitignoreFile.existsSync()) {
        final content = gitignoreFile.readAsStringSync();
        if (content == _gitignoreContent) {
          return; // Already has our marker
        }
      }
      throw const PickforgeDirConflictException(
        '.pickforge/ exists without Pickforge .gitignore marker. '
        'Remove or rename the directory and try again.',
      );
    }

    pickforgeDir.createSync(recursive: true);
    gitignoreFile.writeAsStringSync(_gitignoreContent);
  }

  /// Writes the three context files into `.pickforge/`.
  Future<void> writeContext({
    required String projectRoot,
    required String skillContent,
    required String widgetContextContent,
    required String runLogContent,
  }) async {
    final dir = '$projectRoot/$_dirName';

    await File('$dir/skill-active.md').writeAsString(skillContent);
    await File('$dir/widget-context.md').writeAsString(widgetContextContent);
    await File('$dir/run-log.json').writeAsString(runLogContent);
  }
}

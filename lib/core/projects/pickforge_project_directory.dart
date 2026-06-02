import 'dart:io';

import 'package:path/path.dart' as p;

class PickforgeDirConflictException implements Exception {
  const PickforgeDirConflictException(this.message);

  final String message;

  @override
  String toString() => 'PickforgeDirConflictException: $message';
}

class PickforgeProjectDirectory {
  const PickforgeProjectDirectory._();

  static Future<Directory> ensure(String projectRoot) {
    return ensureDirectory(Directory(p.join(projectRoot, '.pickforge')));
  }

  static Future<Directory> ensureDirectory(Directory dir) async {
    final gitignore = File(p.join(dir.path, '.gitignore'));
    if (dir.existsSync()) {
      if (gitignore.existsSync() && gitignore.readAsStringSync() == '*\n') {
        return dir;
      }
      throw const PickforgeDirConflictException(
        '.pickforge/ exists without Pickforge .gitignore marker. '
        'Remove or rename the directory and try again.',
      );
    }
    await dir.create(recursive: true);
    await gitignore.writeAsString('*\n', flush: true);
    return dir;
  }
}

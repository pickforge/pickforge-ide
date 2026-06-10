import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

/// Persists clipboard images under the project so the terminal can reference
/// them by a short relative path (the shell's cwd is the project root).
class PastedImageStore {
  const PastedImageStore();

  static const _retention = Duration(days: 7);

  Future<String> save(Uint8List bytes, {required String projectRoot}) async {
    final dir = Directory(p.join(projectRoot, '.pickforge', 'pastes'));
    await dir.create(recursive: true);
    await _prune(dir);
    final stamp = DateTime.now()
        .toUtc()
        .toIso8601String()
        .replaceAll(':', '-')
        .replaceAll('.', '-');
    var file = File(p.join(dir.path, 'paste-$stamp.png'));
    var suffix = 1;
    while (file.existsSync()) {
      file = File(p.join(dir.path, 'paste-$stamp-$suffix.png'));
      suffix++;
    }
    await file.writeAsBytes(bytes);
    return p.join('.pickforge', 'pastes', p.basename(file.path));
  }

  Future<void> _prune(Directory dir) async {
    final cutoff = DateTime.now().subtract(_retention);
    await for (final entry in dir.list()) {
      if (entry is! File) continue;
      try {
        if (entry.lastModifiedSync().isBefore(cutoff)) await entry.delete();
      } on FileSystemException {
        // A vanished or unreadable paste must not break pasting.
      }
    }
  }
}

import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

import 'package:pickforge/core/storage/context_storage_service.dart';

/// Persists clipboard images under the resolved context dir so the terminal can
/// reference them by a short path (the shell's cwd is the project root, so
/// project-local pastes resolve as a relative `.pickforge/pastes/...` path).
class PastedImageStore {
  const PastedImageStore(this._storage);

  final ContextStorageService _storage;

  static const _retention = Duration(days: 7);

  Future<String> save(Uint8List bytes, {required String projectRoot}) async {
    final resolved = await _storage.ensure(projectRoot);
    final dir = Directory(p.join(resolved.pastesDir));
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
    // Project-local pastes live under the cwd, so hand the terminal a relative
    // POSIX path (forward slashes resolve on every supported host). Home/custom
    // pastes live outside the project, so the absolute path is the only one the
    // shell can resolve.
    if (resolved.isProjectLocal) {
      final rel = p.relative(file.path, from: projectRoot);
      return p.posix.joinAll(p.split(rel));
    }
    return file.path;
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

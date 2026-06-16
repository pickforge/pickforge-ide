import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/resolved_context_directory.dart';

/// A summary of what data exists in a source storage location, used to confirm
/// a copy with the user before switching a project's storage mode.
class StorageCopyPlan {
  const StorageCopyPlan({
    required this.chatCount,
    required this.runCount,
    required this.hasContextFiles,
    required this.pasteCount,
    required this.skillCount,
    required this.promptTemplateCount,
  });

  final int chatCount;
  final int runCount;
  final bool hasContextFiles;
  final int pasteCount;
  final int skillCount;
  final int promptTemplateCount;

  bool get isEmpty =>
      chatCount == 0 &&
      runCount == 0 &&
      !hasContextFiles &&
      pasteCount == 0 &&
      skillCount == 0 &&
      promptTemplateCount == 0;
}

/// Copies existing context data from one resolved location to another when a
/// project switches storage mode. It NEVER deletes the source and NEVER
/// clobbers an existing destination file — switching back leaves the old data
/// intact, and re-running is safe.
class ContextStorageMigrator {
  const ContextStorageMigrator();

  /// Inventory of the source location (counts shown in the confirm dialog).
  StorageCopyPlan plan(ResolvedContextDirectory from) {
    return StorageCopyPlan(
      chatCount: _childDirCount(from.chatsDir),
      runCount: _childDirCount(from.runsDir),
      hasContextFiles: _hasTopLevelFiles(from.contextDir),
      pasteCount: _childEntryCount(from.pastesDir),
      skillCount: _childEntryCount(from.skillsDir),
      promptTemplateCount: _childEntryCount(from.promptTemplatesDir),
    );
  }

  Future<void> copy(
    ResolvedContextDirectory from,
    ResolvedContextDirectory to,
  ) async {
    // Context files live directly in `contextDir`. For project-local that dir
    // is `.pickforge/`, which also CONTAINS chats/runs/pastes/... — so copy its
    // top-level files only and handle each subtree separately to avoid
    // double-copying.
    await _copyTopLevelFiles(from.contextDir, to.contextDir);
    for (final pair in [
      [from.chatsDir, to.chatsDir],
      [from.runsDir, to.runsDir],
      [from.pastesDir, to.pastesDir],
      [from.skillsDir, to.skillsDir],
      [from.promptTemplatesDir, to.promptTemplatesDir],
    ]) {
      await _copyTree(pair[0], pair[1]);
    }
  }

  int _childDirCount(String dir) {
    final d = Directory(dir);
    if (!d.existsSync()) return 0;
    return d.listSync(followLinks: false).whereType<Directory>().length;
  }

  /// Counts entries (files or directories) in a subtree, ignoring the
  /// project-local `.gitignore` marker. Pastes are files; skills and
  /// prompt-template overrides may be files or directories.
  int _childEntryCount(String dir) {
    final d = Directory(dir);
    if (!d.existsSync()) return 0;
    return d
        .listSync(followLinks: false)
        .where((e) => p.basename(e.path) != '.gitignore')
        .length;
  }

  bool _hasTopLevelFiles(String dir) {
    final d = Directory(dir);
    if (!d.existsSync()) return false;
    return d
        .listSync(followLinks: false)
        .whereType<File>()
        .any((f) => p.basename(f.path) != '.gitignore');
  }

  Future<void> _copyTopLevelFiles(String fromDir, String toDir) async {
    final src = Directory(fromDir);
    if (!src.existsSync()) return;
    for (final entity in src.listSync(followLinks: false)) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      if (name == '.gitignore') continue; // the marker is project-local-only
      final dest = File(p.join(toDir, name));
      if (dest.existsSync()) continue; // never clobber
      await Directory(toDir).create(recursive: true);
      await entity.copy(dest.path);
    }
  }

  Future<void> _copyTree(String fromDir, String toDir) async {
    final src = Directory(fromDir);
    if (!src.existsSync()) return;
    if (p.equals(p.canonicalize(fromDir), p.canonicalize(toDir))) return;
    await for (final entity in src.list(recursive: true, followLinks: false)) {
      final rel = p.relative(entity.path, from: fromDir);
      final destPath = p.join(toDir, rel);
      if (entity is Directory) {
        await Directory(destPath).create(recursive: true);
      } else if (entity is File) {
        final dest = File(destPath);
        if (dest.existsSync()) continue; // never clobber
        await dest.parent.create(recursive: true);
        await entity.copy(dest.path);
      }
    }
  }
}

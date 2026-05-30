import 'dart:io';

import 'package:path/path.dart' as p;

class GitignoreHelper {
  const GitignoreHelper();

  static const _entry = '.pickforge/';

  bool isGitRepo(String projectRoot) {
    final gitPath = p.join(projectRoot, '.git');
    return FileSystemEntity.typeSync(gitPath) != FileSystemEntityType.notFound;
  }

  Future<bool> needsEntry(String projectRoot) async {
    if (!isGitRepo(projectRoot)) return false;
    final file = File(p.join(projectRoot, '.gitignore'));
    if (!file.existsSync()) return true;
    final lines = (await file.readAsString()).split('\n').map((l) => l.trim());
    for (final line in lines) {
      if (line == '.pickforge' || line == '.pickforge/') return false;
    }
    return true;
  }

  Future<void> appendEntry(String projectRoot) async {
    final file = File(p.join(projectRoot, '.gitignore'));
    if (!file.existsSync()) {
      await file.writeAsString('$_entry\n');
      return;
    }
    final current = await file.readAsString();
    final needsLeadingNewline = current.isNotEmpty && !current.endsWith('\n');
    final suffix = needsLeadingNewline ? '\n$_entry\n' : '$_entry\n';
    await file.writeAsString(suffix, mode: FileMode.append);
  }
}

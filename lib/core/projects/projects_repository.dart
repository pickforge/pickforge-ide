import 'dart:io';

import 'package:injectable/injectable.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

class ProjectAddError implements Exception {
  ProjectAddError(this.message);

  final String message;

  @override
  String toString() => 'ProjectAddError: $message';
}

@lazySingleton
class ProjectsRepository {
  ProjectsRepository(this._dao);

  final ProjectsDao _dao;

  Future<List<ProjectRow>> list() => _dao.allOrderedByLastOpened();

  Future<ProjectRow> add(String rawPath) async {
    final canonical = p.canonicalize(rawPath);
    if (!Directory(canonical).existsSync()) {
      throw ProjectAddError('Folder does not exist: $canonical');
    }
    if (!File(p.join(canonical, 'pubspec.yaml')).existsSync()) {
      throw ProjectAddError('Folder must contain pubspec.yaml');
    }
    final now = DateTime.now();
    await _dao.upsert(
      projectRoot: canonical,
      displayName: p.basename(canonical),
      now: now,
    );
    return (await _dao.allOrderedByLastOpened())
        .firstWhere((r) => r.projectRoot == canonical);
  }

  Future<void> touch(String projectRoot) =>
      _dao.touch(projectRoot, DateTime.now());

  Future<void> rename(String projectRoot, String displayName) =>
      _dao.rename(projectRoot, displayName);

  Future<void> remove(String projectRoot) => _dao.remove(projectRoot);
}

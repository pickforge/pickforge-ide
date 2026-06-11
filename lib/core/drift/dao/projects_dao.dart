import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

part 'projects_dao.g.dart';

@DriftAccessor(tables: [Projects])
class ProjectsDao extends DatabaseAccessor<PickforgeDatabase>
    with _$ProjectsDaoMixin {
  ProjectsDao(super.attachedDatabase);

  Future<void> upsert({
    required String projectRoot,
    required String displayName,
    required DateTime now,
  }) {
    return into(projects).insertOnConflictUpdate(
      ProjectsCompanion(
        projectRoot: Value(projectRoot),
        displayName: Value(displayName),
        createdAt: Value(now),
        lastOpenedAt: Value(now),
      ),
    );
  }

  Future<void> touch(String projectRoot, DateTime now) {
    return (update(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .write(ProjectsCompanion(lastOpenedAt: Value(now)));
  }

  Future<void> rename(String projectRoot, String displayName) {
    return (update(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .write(ProjectsCompanion(displayName: Value(displayName)));
  }

  Future<void> remove(String projectRoot) {
    return (delete(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .go();
  }

  Future<void> setArchived(String projectRoot, DateTime? archivedAt) {
    return (update(projects)..where((p) => p.projectRoot.equals(projectRoot)))
        .write(ProjectsCompanion(archivedAt: Value(archivedAt)));
  }

  /// Moves a project (and its dependent rows) to a new root path. Used when
  /// the user relocated the folder on disk.
  Future<void> relocate(String oldRoot, String newRoot) {
    return transaction(() async {
      final row = await (select(projects)
            ..where((p) => p.projectRoot.equals(oldRoot)))
          .getSingleOrNull();
      if (row == null) return;
      await into(projects).insert(
        row.toCompanion(false).copyWith(projectRoot: Value(newRoot)),
        mode: InsertMode.insertOrIgnore,
      );
      await customStatement(
        'UPDATE chats SET project_root = ?1 WHERE project_root = ?2',
        [newRoot, oldRoot],
      );
      await customStatement(
        'UPDATE OR IGNORE project_settings SET project_root = ?1 '
        'WHERE project_root = ?2',
        [newRoot, oldRoot],
      );
      // Chats were re-pointed above, so the FK cascade deletes nothing.
      await (delete(projects)..where((p) => p.projectRoot.equals(oldRoot)))
          .go();
    });
  }

  Future<List<ProjectRow>> allOrderedByLastOpened() {
    return (select(projects)
          ..where((p) => p.archivedAt.isNull())
          ..orderBy([
            (p) => OrderingTerm(expression: p.sortOrder),
            (p) => OrderingTerm(
                  expression: p.lastOpenedAt,
                  mode: OrderingMode.desc,
                ),
          ]))
        .get();
  }

  Future<List<ProjectRow>> archived() {
    return (select(projects)
          ..where((p) => p.archivedAt.isNotNull())
          ..orderBy([
            (p) => OrderingTerm(
                  expression: p.archivedAt,
                  mode: OrderingMode.desc,
                ),
          ]))
        .get();
  }
}

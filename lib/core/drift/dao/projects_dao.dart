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

  Future<List<ProjectRow>> allOrderedByLastOpened() {
    return (select(projects)
          ..orderBy([
            (p) => OrderingTerm(expression: p.sortOrder),
            (p) => OrderingTerm(
                  expression: p.lastOpenedAt,
                  mode: OrderingMode.desc,
                ),
          ]))
        .get();
  }
}

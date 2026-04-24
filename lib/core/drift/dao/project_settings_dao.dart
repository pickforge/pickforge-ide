import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';

part 'project_settings_dao.g.dart';

@DriftAccessor(tables: [ProjectSettings])
class ProjectSettingsDao extends DatabaseAccessor<PickforgeDatabase>
    with _$ProjectSettingsDaoMixin {
  ProjectSettingsDao(super.attachedDatabase);

  Future<ProjectSettingsRow?> loadFor(String projectRoot) {
    return (select(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .getSingleOrNull();
  }

  Future<void> upsert({
    required String projectRoot,
    String? vmServiceUrl,
    String? defaultAgentId,
    String? defaultTerminalId,
  }) {
    final companion = ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl: Value(vmServiceUrl),
      defaultAgentId: Value(defaultAgentId),
      defaultTerminalId: Value(defaultTerminalId),
      lastUsedAt: Value(DateTime.now()),
    );
    return into(projectSettings).insertOnConflictUpdate(companion);
  }
}

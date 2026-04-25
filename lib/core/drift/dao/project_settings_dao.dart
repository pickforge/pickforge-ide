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
    DateTime? now,
  }) {
    final companion = ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl:
          vmServiceUrl == null ? const Value.absent() : Value(vmServiceUrl),
      defaultAgentId:
          defaultAgentId == null ? const Value.absent() : Value(defaultAgentId),
      lastUsedAt: Value(now ?? DateTime.now()),
    );
    return into(projectSettings).insertOnConflictUpdate(companion);
  }

  Future<void> setLastChatId(String projectRoot, String? chatId) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(ProjectSettingsCompanion(lastChatId: Value(chatId)));
  }

  Future<String?> lastChatId(String projectRoot) async {
    final row = await loadFor(projectRoot);
    return row?.lastChatId;
  }

  Future<void> setPaneSizes(String projectRoot, String? json) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(ProjectSettingsCompanion(paneSizes: Value(json)));
  }

  Future<String?> paneSizes(String projectRoot) async {
    final row = await loadFor(projectRoot);
    return row?.paneSizes;
  }
}

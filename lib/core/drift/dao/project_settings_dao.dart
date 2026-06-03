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
    Object? vmServiceUrl = const Value<String?>.absent(),
    Object? defaultAgentId = const Value<String?>.absent(),
    Object? avdId = const Value<String?>.absent(),
    Object? avdName = const Value<String?>.absent(),
    Value<String> connectionMode = const Value.absent(),
    Object? flutterRunArgs = const Value<String?>.absent(),
    Object? targetFile = const Value<String?>.absent(),
    Object? emulatorLaunchOptions = const Value<String?>.absent(),
    Object? emulatorIdleShutdown = const Value<String?>.absent(),
    bool? autoBootOnSelect,
    DateTime? now,
  }) {
    final companion = ProjectSettingsCompanion(
      projectRoot: Value(projectRoot),
      vmServiceUrl: _nullableTextValue(vmServiceUrl),
      defaultAgentId: _nullableTextValue(defaultAgentId),
      avdId: _nullableTextValue(avdId),
      avdName: _nullableTextValue(avdName),
      connectionMode: connectionMode,
      flutterRunArgs: _nullableTextValue(flutterRunArgs),
      targetFile: _nullableTextValue(targetFile),
      emulatorLaunchOptions: _nullableTextValue(emulatorLaunchOptions),
      emulatorIdleShutdown: _nullableTextValue(emulatorIdleShutdown),
      autoBootOnSelect: autoBootOnSelect == null
          ? const Value.absent()
          : Value(autoBootOnSelect),
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

  Future<void> clearEmulatorBinding(String projectRoot) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(
      const ProjectSettingsCompanion(
        avdId: Value(null),
        avdName: Value(null),
        vmServiceUrl: Value(null),
      ),
    );
  }

  Future<void> markFirstRunCelebrated(String projectRoot) {
    return (update(projectSettings)
          ..where((t) => t.projectRoot.equals(projectRoot)))
        .write(
      const ProjectSettingsCompanion(
        firstRunCelebrated: Value(true),
      ),
    );
  }

  Value<String?> _nullableTextValue(Object? value) {
    if (value is Value) {
      return value.present
          ? Value(value.value as String?)
          : const Value.absent();
    }
    if (value is String?) return Value(value);
    throw ArgumentError.value(
      value,
      'value',
      'Expected String? or Value<String?>',
    );
  }
}

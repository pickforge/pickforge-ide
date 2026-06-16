import 'package:drift/drift.dart';

@DataClassName('ProjectSettingsRow')
class ProjectSettings extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get defaultAgentId => text().nullable()();
  TextColumn get lastChatId => text().nullable()();
  TextColumn get paneSizes => text().nullable()();
  DateTimeColumn get lastUsedAt => dateTime().nullable()();

  TextColumn get avdId => text().nullable()();
  TextColumn get avdName => text().nullable()();
  TextColumn get connectionMode => text().withDefault(const Constant('auto'))();
  TextColumn get flutterRunArgs => text().nullable()();
  TextColumn get targetFile => text().nullable()();
  TextColumn get validatorCommand => text().nullable()();
  TextColumn get emulatorLaunchOptions => text().nullable()();
  TextColumn get emulatorIdleShutdown => text().nullable()();
  BoolColumn get autoBootOnSelect =>
      boolean().withDefault(const Constant(true))();
  BoolColumn get firstRunCelebrated =>
      boolean().withDefault(const Constant(false))();

  TextColumn get contextStorageMode => text().nullable()();
  TextColumn get contextStorageCustomPath => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}

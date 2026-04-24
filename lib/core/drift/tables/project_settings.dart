import 'package:drift/drift.dart';

@DataClassName('ProjectSettingsRow')
class ProjectSettings extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get defaultAgentId => text().nullable()();
  TextColumn get defaultTerminalId => text().nullable()();
  DateTimeColumn get lastUsedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}

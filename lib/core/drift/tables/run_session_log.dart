import 'package:drift/drift.dart';

@DataClassName('RunSessionLogRow')
class RunSessionLog extends Table {
  TextColumn get sessionId => text()();
  TextColumn get projectRoot => text()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get endedAt => dateTime().nullable()();
  TextColumn get avdId => text().nullable()();
  TextColumn get avdName => text().nullable()();
  TextColumn get serial => text().nullable()();
  TextColumn get vmServiceUrl => text().nullable()();
  TextColumn get connectionMode => text()();
  TextColumn get exitReason => text().nullable()();
  IntColumn get exitCode => integer().nullable()();
  IntColumn get hotReloadCount => integer().withDefault(const Constant(0))();
  IntColumn get hotRestartCount => integer().withDefault(const Constant(0))();
  IntColumn get errorCount => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {sessionId};
}

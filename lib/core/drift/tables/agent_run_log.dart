import 'package:drift/drift.dart';

@DataClassName('AgentRunLogRow')
class AgentRunLog extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get pickId => integer()();
  DateTimeColumn get startedAt => dateTime()();
  DateTimeColumn get finishedAt => dateTime().nullable()();
  IntColumn get exitCode => integer().nullable()();
  IntColumn get hotReloadCount => integer().withDefault(const Constant(0))();
  TextColumn get wrapperScriptPath => text()();
}

import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

@DataClassName('ChatRow')
class Chats extends Table {
  TextColumn get chatId => text()();
  TextColumn get projectRoot =>
      text().references(Projects, #projectRoot, onDelete: KeyAction.cascade)();
  TextColumn get title => text()();
  TextColumn get agentId => text()();
  TextColumn get skillId => text().nullable()();
  TextColumn get sessionId => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastActivityAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  @override
  Set<Column<Object>> get primaryKey => {chatId};
}

import 'package:drift/drift.dart';

@DataClassName('PickHistoryRow')
class PickHistory extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get projectRoot => text()();
  TextColumn get widgetClass => text()();
  TextColumn get creationFile => text().nullable()();
  IntColumn get creationLine => integer().nullable()();
  TextColumn get skillId => text()();
  TextColumn get agentId => text()();
  TextColumn get terminalId => text()();
  TextColumn get chatId => text().nullable()();
  DateTimeColumn get pickedAt => dateTime()();
  TextColumn get widgetContextJson => text()();
}

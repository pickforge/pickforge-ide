import 'package:drift/drift.dart';

@DataClassName('ProjectRow')
class Projects extends Table {
  TextColumn get projectRoot => text()();
  TextColumn get displayName => text()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get lastOpenedAt => dateTime()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();

  /// Soft delete: archived projects leave the workspace but stay restorable
  /// from Settings.
  DateTimeColumn get archivedAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {projectRoot};
}

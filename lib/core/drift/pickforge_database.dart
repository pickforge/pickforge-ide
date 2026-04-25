import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/agent_run_log_dao.dart';
import 'package:pickforge/core/drift/dao/pick_history_dao.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/tables/agent_run_log.dart';
import 'package:pickforge/core/drift/tables/pick_history.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

part 'pickforge_database.g.dart';

@DriftDatabase(
  tables: [ProjectSettings, PickHistory, AgentRunLog, Projects],
  daos: [ProjectSettingsDao, PickHistoryDao, AgentRunLogDao, ProjectsDao],
)
@lazySingleton
class PickforgeDatabase extends _$PickforgeDatabase {
  PickforgeDatabase() : super(driftDatabase(name: 'pickforge'));

  PickforgeDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
      );
}

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/agent_run_log_dao.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/pick_history_dao.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/dao/run_session_log_dao.dart';
import 'package:pickforge/core/drift/tables/agent_run_log.dart';
import 'package:pickforge/core/drift/tables/chats.dart';
import 'package:pickforge/core/drift/tables/pick_history.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';
import 'package:pickforge/core/drift/tables/projects.dart';
import 'package:pickforge/core/drift/tables/run_session_log.dart';

part 'pickforge_database.g.dart';

@DriftDatabase(
  tables: [
    ProjectSettings,
    PickHistory,
    AgentRunLog,
    Projects,
    Chats,
    RunSessionLog,
  ],
  daos: [
    ProjectSettingsDao,
    PickHistoryDao,
    AgentRunLogDao,
    ProjectsDao,
    ChatsDao,
    RunSessionLogDao,
  ],
)
@lazySingleton
class PickforgeDatabase extends _$PickforgeDatabase {
  PickforgeDatabase() : super(driftDatabase(name: 'pickforge'));

  PickforgeDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 7;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          await m.createAll();
          await m.createIndex(
            Index(
              'idx_run_session_log_project_started',
              'CREATE INDEX idx_run_session_log_project_started '
                  'ON run_session_log (project_root, started_at DESC)',
            ),
          );
        },
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.createTable(projects);
            await m.createTable(chats);
            await m.addColumn(projectSettings, projectSettings.lastChatId);
            await m.addColumn(projectSettings, projectSettings.paneSizes);
            await m.addColumn(pickHistory, pickHistory.chatId);
            await customStatement(
              'ALTER TABLE project_settings DROP COLUMN default_terminal_id;',
            );

            final rows = await customSelect(
              'SELECT project_root, last_used_at FROM project_settings',
            ).get();
            for (final r in rows) {
              final root = r.read<String>('project_root');
              final lastTs = r.readNullable<int>('last_used_at');
              final last = lastTs != null
                  ? DateTime.fromMillisecondsSinceEpoch(lastTs)
                  : DateTime.now();
              final name = root.split(RegExp(r'[/\\]')).last;
              await into(projects).insert(
                ProjectsCompanion(
                  projectRoot: Value(root),
                  displayName: Value(name.isEmpty ? root : name),
                  createdAt: Value(last),
                  lastOpenedAt: Value(last),
                ),
                mode: InsertMode.insertOrIgnore,
              );
            }
          }
          if (from < 3) {
            await m.addColumn(projectSettings, projectSettings.avdId);
            await m.addColumn(projectSettings, projectSettings.avdName);
            await m.addColumn(
              projectSettings,
              projectSettings.connectionMode,
            );
            await m.addColumn(
              projectSettings,
              projectSettings.flutterRunArgs,
            );
            await m.addColumn(projectSettings, projectSettings.targetFile);
            await m.addColumn(
              projectSettings,
              projectSettings.autoBootOnSelect,
            );
            await m.addColumn(
              projectSettings,
              projectSettings.firstRunCelebrated,
            );
            await m.createTable(runSessionLog);
            await m.createIndex(
              Index(
                'idx_run_session_log_project_started',
                'CREATE INDEX idx_run_session_log_project_started '
                    'ON run_session_log (project_root, started_at DESC)',
              ),
            );
            await customStatement(
              "UPDATE project_settings SET connection_mode = 'manual' "
              'WHERE vm_service_url IS NOT NULL',
            );
          }
          if (from >= 3 && from < 4) {
            await m.addColumn(runSessionLog, runSessionLog.targetFile);
          }
          if (from < 5) {
            await m.addColumn(
              projectSettings,
              projectSettings.emulatorLaunchOptions,
            );
          }
          if (from < 6) {
            await m.addColumn(
              projectSettings,
              projectSettings.emulatorIdleShutdown,
            );
          }
          if (from < 7) {
            final chatTables = await customSelect(
              "SELECT name FROM sqlite_master WHERE type = 'table' "
              "AND name = 'chats'",
            ).get();
            if (chatTables.isNotEmpty) {
              final columns = await customSelect(
                'PRAGMA table_info(chats);',
              ).get();
              final names = columns.map((r) => r.read<String>('name')).toSet();
              if (!names.contains('labels_json')) {
                await m.addColumn(chats, chats.labelsJson);
              }
              if (!names.contains('status')) {
                await m.addColumn(chats, chats.status);
              }
              if (!names.contains('task_brief_text')) {
                await m.addColumn(chats, chats.taskBriefText);
              }
            }
          }
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA foreign_keys = ON;');
        },
      );
}

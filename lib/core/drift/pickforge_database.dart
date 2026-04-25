import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/agent_run_log_dao.dart';
import 'package:pickforge/core/drift/dao/chats_dao.dart';
import 'package:pickforge/core/drift/dao/pick_history_dao.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/core/drift/dao/projects_dao.dart';
import 'package:pickforge/core/drift/tables/agent_run_log.dart';
import 'package:pickforge/core/drift/tables/chats.dart';
import 'package:pickforge/core/drift/tables/pick_history.dart';
import 'package:pickforge/core/drift/tables/project_settings.dart';
import 'package:pickforge/core/drift/tables/projects.dart';

part 'pickforge_database.g.dart';

@DriftDatabase(
  tables: [ProjectSettings, PickHistory, AgentRunLog, Projects, Chats],
  daos: [
    ProjectSettingsDao,
    PickHistoryDao,
    AgentRunLogDao,
    ProjectsDao,
    ChatsDao,
  ],
)
@lazySingleton
class PickforgeDatabase extends _$PickforgeDatabase {
  PickforgeDatabase() : super(driftDatabase(name: 'pickforge'));

  PickforgeDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.createTable(projects);
            await m.createTable(chats);
            await m.addColumn(projectSettings, projectSettings.lastChatId);
            await m.addColumn(projectSettings, projectSettings.paneSizes);
            await m.addColumn(pickHistory, pickHistory.chatId);

            final rows = await customSelect(
              'SELECT project_root, last_used_at FROM project_settings',
            ).get();
            for (final r in rows) {
              final root = r.read<String>('project_root');
              final lastTs = r.readNullable<int>('last_used_at');
              final last = lastTs != null
                  ? DateTime.fromMillisecondsSinceEpoch(lastTs)
                  : DateTime.now();
              final name = root.split(Platform.pathSeparator).last;
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
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA foreign_keys = ON;');
        },
      );
}

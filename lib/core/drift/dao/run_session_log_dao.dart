import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/run_session_log.dart';

part 'run_session_log_dao.g.dart';

@DriftAccessor(tables: [RunSessionLog])
class RunSessionLogDao extends DatabaseAccessor<PickforgeDatabase>
    with _$RunSessionLogDaoMixin {
  RunSessionLogDao(super.attachedDatabase);

  Future<void> recordStart({
    required String sessionId,
    required String projectRoot,
    required DateTime startedAt,
    required String connectionMode,
    String? avdId,
    String? avdName,
    String? serial,
    String? vmServiceUrl,
    String? targetFile,
  }) {
    return into(runSessionLog).insertOnConflictUpdate(
      RunSessionLogCompanion(
        sessionId: Value(sessionId),
        projectRoot: Value(projectRoot),
        startedAt: Value(startedAt),
        connectionMode: Value(connectionMode),
        avdId: Value(avdId),
        avdName: Value(avdName),
        serial: Value(serial),
        vmServiceUrl: Value(vmServiceUrl),
        targetFile: Value(targetFile),
      ),
    );
  }

  Future<void> recordVmServiceUrl({
    required String sessionId,
    required String vmServiceUrl,
  }) {
    return (update(runSessionLog)..where((t) => t.sessionId.equals(sessionId)))
        .write(
      RunSessionLogCompanion(vmServiceUrl: Value(vmServiceUrl)),
    );
  }

  Future<void> recordEnd({
    required String sessionId,
    required DateTime endedAt,
    required String exitReason,
    int? exitCode,
    int hotReloadCount = 0,
    int hotRestartCount = 0,
    int errorCount = 0,
    String? lastError,
  }) {
    return (update(runSessionLog)..where((t) => t.sessionId.equals(sessionId)))
        .write(
      RunSessionLogCompanion(
        endedAt: Value(endedAt),
        exitReason: Value(exitReason),
        exitCode: Value(exitCode),
        hotReloadCount: Value(hotReloadCount),
        hotRestartCount: Value(hotRestartCount),
        errorCount: Value(errorCount),
        lastError: Value(lastError),
      ),
    );
  }

  Future<List<RunSessionLogRow>> recentFor(
    String projectRoot, {
    int limit = 20,
  }) {
    return (select(runSessionLog)
          ..where((t) => t.projectRoot.equals(projectRoot))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
          ..limit(limit))
        .get();
  }

  Stream<List<RunSessionLogRow>> watchRecent(
    String projectRoot, {
    int limit = 20,
  }) {
    return (select(runSessionLog)
          ..where((t) => t.projectRoot.equals(projectRoot))
          ..orderBy([(t) => OrderingTerm.desc(t.startedAt)])
          ..limit(limit))
        .watch();
  }

  Future<RunSessionLogRow?> latestFor(String projectRoot) async {
    final rows = await recentFor(projectRoot, limit: 1);
    return rows.isEmpty ? null : rows.first;
  }

  Future<void> pruneToCap(String projectRoot, {int cap = 100}) {
    return customStatement(
      'DELETE FROM run_session_log '
      'WHERE project_root = ?1 AND session_id NOT IN ( '
      'SELECT session_id FROM run_session_log '
      'WHERE project_root = ?1 ORDER BY started_at DESC LIMIT ?2)',
      [projectRoot, cap],
    );
  }
}

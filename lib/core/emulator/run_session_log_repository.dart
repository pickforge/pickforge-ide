import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

@lazySingleton
class RunSessionLogRepository {
  RunSessionLogRepository(this._db);

  final PickforgeDatabase _db;

  Future<void> recordStart({
    required String sessionId,
    required String projectRoot,
    required DateTime startedAt,
    required String connectionMode,
    String? avdId,
    String? avdName,
    String? serial,
    String? vmServiceUrl,
    int cap = 100,
  }) async {
    await _db.runSessionLogDao.recordStart(
      sessionId: sessionId,
      projectRoot: projectRoot,
      startedAt: startedAt,
      connectionMode: connectionMode,
      avdId: avdId,
      avdName: avdName,
      serial: serial,
      vmServiceUrl: vmServiceUrl,
    );
    await _db.runSessionLogDao.pruneToCap(projectRoot, cap: cap);
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
  }) =>
      _db.runSessionLogDao.recordEnd(
        sessionId: sessionId,
        endedAt: endedAt,
        exitReason: exitReason,
        exitCode: exitCode,
        hotReloadCount: hotReloadCount,
        hotRestartCount: hotRestartCount,
        errorCount: errorCount,
        lastError: lastError,
      );

  Future<List<RunSessionLogRow>> recentFor(
    String projectRoot, {
    int limit = 20,
  }) =>
      _db.runSessionLogDao.recentFor(projectRoot, limit: limit);

  Stream<List<RunSessionLogRow>> watchRecent(
    String projectRoot, {
    int limit = 20,
  }) =>
      _db.runSessionLogDao.watchRecent(projectRoot, limit: limit);

  Future<RunSessionLogRow?> latestFor(String projectRoot) =>
      _db.runSessionLogDao.latestFor(projectRoot);

  Future<void> applyCap(String projectRoot, {int cap = 100}) =>
      _db.runSessionLogDao.pruneToCap(projectRoot, cap: cap);
}

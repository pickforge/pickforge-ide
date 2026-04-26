import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

@lazySingleton
class ProjectSettingsRepository {
  ProjectSettingsRepository(this._db);

  final PickforgeDatabase _db;

  Future<String?> getVmServiceUrl(String projectRoot) async {
    final row = await _db.projectSettingsDao.loadFor(projectRoot);
    return row?.vmServiceUrl;
  }

  Future<void> setVmServiceUrl(String projectRoot, String url) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      vmServiceUrl: url,
    );
  }

  Future<String?> getDefaultAgentId(String projectRoot) async =>
      (await _db.projectSettingsDao.loadFor(projectRoot))?.defaultAgentId;

  Future<void> setDefaultAgentId(String projectRoot, String agentId) {
    return _db.projectSettingsDao.upsert(
      projectRoot: projectRoot,
      defaultAgentId: agentId,
    );
  }

  Future<String?> getLastChatId(String projectRoot) =>
      _db.projectSettingsDao.lastChatId(projectRoot);

  Future<void> setLastChatId(String projectRoot, String? chatId) async {
    await _db.projectSettingsDao
        .upsert(projectRoot: projectRoot); // ensure row exists
    await _db.projectSettingsDao.setLastChatId(projectRoot, chatId);
  }

  Future<String?> getPaneSizes(String projectRoot) =>
      _db.projectSettingsDao.paneSizes(projectRoot);

  Future<void> setPaneSizes(String projectRoot, String? json) async {
    await _db.projectSettingsDao
        .upsert(projectRoot: projectRoot); // ensure row exists
    await _db.projectSettingsDao.setPaneSizes(projectRoot, json);
  }
}

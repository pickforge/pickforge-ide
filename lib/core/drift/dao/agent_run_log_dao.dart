import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/agent_run_log.dart';

part 'agent_run_log_dao.g.dart';

@DriftAccessor(tables: [AgentRunLog])
class AgentRunLogDao extends DatabaseAccessor<PickforgeDatabase>
    with _$AgentRunLogDaoMixin {
  AgentRunLogDao(super.attachedDatabase);

  Future<int> recordStart({
    required int pickId,
    required String wrapperScriptPath,
  }) {
    return into(agentRunLog).insert(
      AgentRunLogCompanion.insert(
        pickId: pickId,
        startedAt: DateTime.now(),
        wrapperScriptPath: wrapperScriptPath,
      ),
    );
  }

  Future<void> incrementHotReload(int runId) async {
    await (update(agentRunLog)..where((t) => t.id.equals(runId))).write(
      AgentRunLogCompanion.custom(
        hotReloadCount: agentRunLog.hotReloadCount + const Constant(1),
      ),
    );
  }
}

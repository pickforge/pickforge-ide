// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent_run_log_dao.dart';

// ignore_for_file: type=lint
mixin _$AgentRunLogDaoMixin on DatabaseAccessor<PickforgeDatabase> {
  $AgentRunLogTable get agentRunLog => attachedDatabase.agentRunLog;
  AgentRunLogDaoManager get managers => AgentRunLogDaoManager(this);
}

class AgentRunLogDaoManager {
  final _$AgentRunLogDaoMixin _db;
  AgentRunLogDaoManager(this._db);
  $$AgentRunLogTableTableManager get agentRunLog =>
      $$AgentRunLogTableTableManager(_db.attachedDatabase, _db.agentRunLog);
}

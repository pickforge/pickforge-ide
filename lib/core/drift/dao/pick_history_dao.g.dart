// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'pick_history_dao.dart';

// ignore_for_file: type=lint
mixin _$PickHistoryDaoMixin on DatabaseAccessor<PickforgeDatabase> {
  $PickHistoryTable get pickHistory => attachedDatabase.pickHistory;
  PickHistoryDaoManager get managers => PickHistoryDaoManager(this);
}

class PickHistoryDaoManager {
  final _$PickHistoryDaoMixin _db;
  PickHistoryDaoManager(this._db);
  $$PickHistoryTableTableManager get pickHistory =>
      $$PickHistoryTableTableManager(_db.attachedDatabase, _db.pickHistory);
}

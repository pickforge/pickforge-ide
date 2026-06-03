import 'package:drift/drift.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/drift/tables/pick_history.dart';

part 'pick_history_dao.g.dart';

@DriftAccessor(tables: [PickHistory])
class PickHistoryDao extends DatabaseAccessor<PickforgeDatabase>
    with _$PickHistoryDaoMixin {
  PickHistoryDao(super.attachedDatabase);

  Future<int> insertPick({
    required String projectRoot,
    required String widgetClass,
    required String? creationFile,
    required int? creationLine,
    required String skillId,
    required String agentId,
    required String terminalId,
    required String widgetContextJson,
    String? chatId,
  }) {
    return into(pickHistory).insert(
      PickHistoryCompanion.insert(
        projectRoot: projectRoot,
        widgetClass: widgetClass,
        creationFile: Value(creationFile),
        creationLine: Value(creationLine),
        skillId: skillId,
        agentId: agentId,
        terminalId: terminalId,
        chatId: Value(chatId),
        pickedAt: DateTime.now(),
        widgetContextJson: widgetContextJson,
      ),
    );
  }

  Stream<List<PickHistoryRow>> recent({int limit = 50}) => (select(pickHistory)
        ..orderBy([
          (t) => OrderingTerm.desc(t.pickedAt),
          (t) => OrderingTerm.desc(t.id),
        ])
        ..limit(limit))
      .watch();

  Future<List<PickHistoryRow>> recentForProject(
    String projectRoot, {
    int limit = 50,
  }) =>
      (select(pickHistory)
            ..where((t) => t.projectRoot.equals(projectRoot))
            ..orderBy([
              (t) => OrderingTerm.desc(t.pickedAt),
              (t) => OrderingTerm.desc(t.id),
            ])
            ..limit(limit))
          .get();
}

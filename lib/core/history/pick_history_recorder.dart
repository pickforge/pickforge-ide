import 'dart:convert';

import 'package:pickforge/core/drift/dao/pick_history_dao.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';

class PickHistoryRecorder {
  const PickHistoryRecorder(this._dao);

  final PickHistoryDao _dao;

  Future<int> recordSelection({
    required String projectRoot,
    required SelectedWidget selection,
    required ForgeState forgeState,
    String? chatId,
  }) {
    final location = selection.node.creationLocation;
    return _dao.insertPick(
      projectRoot: projectRoot,
      widgetClass: selection.node.className,
      creationFile: location?.file,
      creationLine: location?.line,
      skillId: forgeState.skill.value,
      agentId: forgeState.agentId.value,
      terminalId: forgeState.terminalId,
      chatId: chatId,
      widgetContextJson: jsonEncode(selection.toJson()),
    );
  }
}

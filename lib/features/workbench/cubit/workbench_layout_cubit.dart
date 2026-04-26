import 'dart:async';
import 'dart:convert';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/drift/dao/project_settings_dao.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';

@injectable
class WorkbenchLayoutCubit extends Cubit<WorkbenchLayoutState> {
  WorkbenchLayoutCubit(this._dao) : super(WorkbenchLayoutState.initial);

  final ProjectSettingsDao _dao;

  Future<void> load(String projectRoot) async {
    final raw = await _dao.paneSizes(projectRoot);
    if (raw == null) {
      emit(state.copyWith(projectRoot: projectRoot));
      return;
    }
    final parsed = jsonDecode(raw) as List<dynamic>;
    emit(
      state.copyWith(
        projectRoot: projectRoot,
        leftWidth: (parsed[0] as num).toDouble(),
        rightWidth: (parsed[1] as num).toDouble(),
      ),
    );
  }

  void updateSizes({required double left, required double right}) {
    emit(state.copyWith(leftWidth: left, rightWidth: right));
    unawaited(_persist());
  }

  void toggleRightCollapsed() {
    emit(state.copyWith(rightCollapsed: !state.rightCollapsed));
  }

  Future<void> _persist() async {
    final root = state.projectRoot;
    if (root == null) return;
    await _dao.setPaneSizes(root, '[${state.leftWidth},${state.rightWidth}]');
  }
}

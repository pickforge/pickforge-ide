import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_state.dart';

@injectable
class WorkspaceSidebarCubit extends Cubit<WorkspaceSidebarState> {
  WorkspaceSidebarCubit(this._repo) : super(const WorkspaceSidebarState());

  final WorkspaceSidebarSettingsRepository _repo;

  Future<void> load() async {
    emit(state.copyWith(loading: true));
    final settings = await _repo.load();
    if (isClosed) return;
    emit(state.copyWith(settings: settings, loading: false));
  }

  void setSearchQuery(String query) {
    emit(state.copyWith(searchQuery: query));
  }

  void setViewMode(WorkspaceSidebarViewMode mode) {
    _update(state.settings.copyWith(viewMode: mode));
  }

  void setGroupingMode(WorkspaceSidebarGroupingMode mode) {
    _update(state.settings.copyWith(groupingMode: mode));
  }

  void setDensity(WorkspaceSidebarDensity density) {
    _update(state.settings.copyWith(density: density));
  }

  void toggleGroupCollapsed(String groupId) {
    final next = {...state.settings.collapsedGroupIds};
    if (!next.remove(groupId)) next.add(groupId);
    _update(state.settings.copyWith(collapsedGroupIds: next));
  }

  void toggleProjectPinned(String projectRoot) {
    final next = {...state.settings.pinnedProjectRoots};
    if (!next.remove(projectRoot)) next.add(projectRoot);
    _update(state.settings.copyWith(pinnedProjectRoots: next));
  }

  void toggleChatPinned(String chatId) {
    final next = {...state.settings.pinnedChatIds};
    if (!next.remove(chatId)) next.add(chatId);
    _update(state.settings.copyWith(pinnedChatIds: next));
  }

  void setChatCustomGroup(String chatId, String? groupName) {
    final groups = {...state.settings.customChatGroups};
    final trimmed = groupName?.trim();
    if (trimmed == null || trimmed.isEmpty) {
      groups.remove(chatId);
    } else {
      groups[chatId] = trimmed;
    }
    _update(state.settings.copyWith(customChatGroups: groups));
  }

  void _update(WorkspaceSidebarSettings settings) {
    emit(state.copyWith(settings: settings));
    unawaited(_repo.save(settings));
  }
}

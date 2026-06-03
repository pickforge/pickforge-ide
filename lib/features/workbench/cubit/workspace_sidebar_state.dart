import 'package:equatable/equatable.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';

class WorkspaceSidebarState extends Equatable {
  const WorkspaceSidebarState({
    this.settings = WorkspaceSidebarSettings.defaults,
    this.searchQuery = '',
    this.loading = false,
  });

  final WorkspaceSidebarSettings settings;
  final String searchQuery;
  final bool loading;

  WorkspaceSidebarState copyWith({
    WorkspaceSidebarSettings? settings,
    String? searchQuery,
    bool? loading,
  }) =>
      WorkspaceSidebarState(
        settings: settings ?? this.settings,
        searchQuery: searchQuery ?? this.searchQuery,
        loading: loading ?? this.loading,
      );

  @override
  List<Object?> get props => [settings, searchQuery, loading];
}

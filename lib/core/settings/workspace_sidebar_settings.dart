import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum WorkspaceSidebarViewMode { list, grid }

enum WorkspaceSidebarGroupingMode {
  project,
  recentActivity,
  pinned,
  agent,
  skill,
  custom,
}

enum WorkspaceSidebarDensity { compact, comfortable }

class WorkspaceSidebarSettings extends Equatable {
  const WorkspaceSidebarSettings({
    this.viewMode = WorkspaceSidebarViewMode.list,
    this.groupingMode = WorkspaceSidebarGroupingMode.project,
    this.density = WorkspaceSidebarDensity.compact,
    this.pinnedProjectRoots = const {},
    this.pinnedChatIds = const {},
    this.collapsedGroupIds = const {},
    this.customChatGroups = const {},
  });

  factory WorkspaceSidebarSettings.fromJson(Map<String, Object?> json) {
    return WorkspaceSidebarSettings(
      viewMode: _enumByName(
        WorkspaceSidebarViewMode.values,
        json['viewMode'],
        WorkspaceSidebarViewMode.list,
      ),
      groupingMode: _enumByName(
        WorkspaceSidebarGroupingMode.values,
        json['groupingMode'],
        WorkspaceSidebarGroupingMode.project,
      ),
      density: _enumByName(
        WorkspaceSidebarDensity.values,
        json['density'],
        WorkspaceSidebarDensity.compact,
      ),
      pinnedProjectRoots: _stringSet(json['pinnedProjectRoots']),
      pinnedChatIds: _stringSet(json['pinnedChatIds']),
      collapsedGroupIds: _stringSet(json['collapsedGroupIds']),
      customChatGroups: _stringMap(json['customChatGroups']),
    );
  }

  final WorkspaceSidebarViewMode viewMode;
  final WorkspaceSidebarGroupingMode groupingMode;
  final WorkspaceSidebarDensity density;
  final Set<String> pinnedProjectRoots;
  final Set<String> pinnedChatIds;
  final Set<String> collapsedGroupIds;
  final Map<String, String> customChatGroups;

  static const defaults = WorkspaceSidebarSettings();

  WorkspaceSidebarSettings copyWith({
    WorkspaceSidebarViewMode? viewMode,
    WorkspaceSidebarGroupingMode? groupingMode,
    WorkspaceSidebarDensity? density,
    Set<String>? pinnedProjectRoots,
    Set<String>? pinnedChatIds,
    Set<String>? collapsedGroupIds,
    Map<String, String>? customChatGroups,
  }) =>
      WorkspaceSidebarSettings(
        viewMode: viewMode ?? this.viewMode,
        groupingMode: groupingMode ?? this.groupingMode,
        density: density ?? this.density,
        pinnedProjectRoots: pinnedProjectRoots ?? this.pinnedProjectRoots,
        pinnedChatIds: pinnedChatIds ?? this.pinnedChatIds,
        collapsedGroupIds: collapsedGroupIds ?? this.collapsedGroupIds,
        customChatGroups: customChatGroups ?? this.customChatGroups,
      );

  Map<String, Object?> toJson() => {
        'viewMode': viewMode.name,
        'groupingMode': groupingMode.name,
        'density': density.name,
        'pinnedProjectRoots': pinnedProjectRoots.toList()..sort(),
        'pinnedChatIds': pinnedChatIds.toList()..sort(),
        'collapsedGroupIds': collapsedGroupIds.toList()..sort(),
        'customChatGroups': customChatGroups,
      };

  @override
  List<Object?> get props => [
        viewMode,
        groupingMode,
        density,
        pinnedProjectRoots,
        pinnedChatIds,
        collapsedGroupIds,
        customChatGroups,
      ];
}

@lazySingleton
class WorkspaceSidebarSettingsRepository {
  WorkspaceSidebarSettingsRepository(this._prefs);

  static const _key = 'workspace.sidebar.settings';

  final SharedPreferences _prefs;

  Future<WorkspaceSidebarSettings> load() async {
    final raw = _prefs.getString(_key);
    if (raw == null || raw.trim().isEmpty) {
      return WorkspaceSidebarSettings.defaults;
    }
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) {
        return WorkspaceSidebarSettings.defaults;
      }
      return WorkspaceSidebarSettings.fromJson(decoded);
    } on Object {
      return WorkspaceSidebarSettings.defaults;
    }
  }

  Future<void> save(WorkspaceSidebarSettings settings) async {
    await _prefs.setString(_key, jsonEncode(settings.toJson()));
  }
}

T _enumByName<T extends Enum>(List<T> values, Object? name, T fallback) {
  if (name is! String) return fallback;
  for (final value in values) {
    if (value.name == name) return value;
  }
  return fallback;
}

Set<String> _stringSet(Object? value) {
  if (value is! List) return const {};
  return value.whereType<String>().toSet();
}

Map<String, String> _stringMap(Object? value) {
  if (value is! Map) return const {};
  return {
    for (final entry in value.entries)
      if (entry.key is String && entry.value is String)
        entry.key! as String: entry.value! as String,
  };
}

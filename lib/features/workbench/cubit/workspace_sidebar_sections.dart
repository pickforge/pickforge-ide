import 'package:equatable/equatable.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';

enum WorkspaceSidebarEntryKind { project, chat }

class WorkspaceSidebarEntry extends Equatable {
  const WorkspaceSidebarEntry.project(this.project)
      : chat = null,
        kind = WorkspaceSidebarEntryKind.project;

  const WorkspaceSidebarEntry.chat(this.chat)
      : project = null,
        kind = WorkspaceSidebarEntryKind.chat;

  final WorkspaceSidebarEntryKind kind;
  final ProjectRow? project;
  final ChatRow? chat;

  String get id => switch (kind) {
        WorkspaceSidebarEntryKind.project => 'project:${project!.projectRoot}',
        WorkspaceSidebarEntryKind.chat => 'chat:${chat!.chatId}',
      };

  String get title => switch (kind) {
        WorkspaceSidebarEntryKind.project => project!.displayName,
        WorkspaceSidebarEntryKind.chat => chat!.title,
      };

  @override
  List<Object?> get props => [kind, project, chat];
}

class WorkspaceSidebarSection extends Equatable {
  const WorkspaceSidebarSection({
    required this.id,
    required this.title,
    required this.entries,
    this.project,
  });

  final String id;
  final String title;
  final List<WorkspaceSidebarEntry> entries;
  final ProjectRow? project;

  @override
  List<Object?> get props => [id, title, entries, project];
}

List<WorkspaceSidebarSection> buildWorkspaceSidebarSections({
  required List<ProjectRow> projects,
  required Map<String, List<ChatRow>> chatsByProject,
  required WorkspaceSidebarSettings settings,
  String query = '',
}) {
  final normalizedQuery = query.trim().toLowerCase();
  // Archived chats never appear in the workspace sidebar — they are managed
  // (restored or permanently deleted) from Settings.
  final visibleChats = {
    for (final entry in chatsByProject.entries)
      entry.key: [
        for (final chat in entry.value)
          if (chat.taskStatus != ChatTaskStatus.archived) chat,
      ],
  };
  final sections = switch (settings.groupingMode) {
    WorkspaceSidebarGroupingMode.project => _byProject(projects, visibleChats),
    WorkspaceSidebarGroupingMode.recentActivity => _byRecent(
        projects,
        visibleChats,
      ),
    WorkspaceSidebarGroupingMode.pinned => _byPinned(
        projects,
        visibleChats,
        settings,
      ),
    WorkspaceSidebarGroupingMode.agent => _byChatField(
        idPrefix: 'agent',
        titleFor: (chat) => chat.agentId,
        chatsByProject: visibleChats,
        projects: projects,
      ),
    WorkspaceSidebarGroupingMode.skill => _byChatField(
        idPrefix: 'skill',
        titleFor: (chat) => chat.skillId ?? 'No skill',
        chatsByProject: visibleChats,
        projects: projects,
      ),
    WorkspaceSidebarGroupingMode.status => _byStatus(
        projects,
        visibleChats,
      ),
    WorkspaceSidebarGroupingMode.label => _byLabel(
        projects,
        visibleChats,
      ),
    WorkspaceSidebarGroupingMode.custom => _byCustom(
        projects,
        visibleChats,
        settings,
      ),
  };
  if (normalizedQuery.isEmpty) return sections;
  return sections.map(
    (section) {
      // A section whose own title matches (e.g. the project name) keeps all
      // of its entries — searching "lucky_app" should still show its chats.
      if (section.title.toLowerCase().contains(normalizedQuery)) {
        return section;
      }
      return WorkspaceSidebarSection(
        id: section.id,
        title: section.title,
        project: section.project,
        entries: section.entries.where((entry) {
          return entry.title.toLowerCase().contains(normalizedQuery) ||
              switch (entry.kind) {
                WorkspaceSidebarEntryKind.project => entry.project!.projectRoot
                    .toLowerCase()
                    .contains(normalizedQuery),
                WorkspaceSidebarEntryKind.chat => entry.chat!.agentId
                        .toLowerCase()
                        .contains(normalizedQuery) ||
                    (entry.chat!.skillId
                            ?.toLowerCase()
                            .contains(normalizedQuery) ??
                        false) ||
                    entry.chat!.taskStatus.displayName
                        .toLowerCase()
                        .contains(normalizedQuery) ||
                    (entry.chat!.taskBrief
                            ?.toLowerCase()
                            .contains(normalizedQuery) ??
                        false) ||
                    entry.chat!.taskLabels.any(
                      (label) => label.toLowerCase().contains(normalizedQuery),
                    ),
              };
        }).toList(),
      );
    },
  ).where((section) {
    return section.entries.isNotEmpty ||
        section.title.toLowerCase().contains(normalizedQuery);
  }).toList();
}

List<WorkspaceSidebarSection> _byProject(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
) {
  return [
    for (final project in projects)
      WorkspaceSidebarSection(
        id: 'project:${project.projectRoot}',
        title: project.displayName,
        project: project,
        entries: [
          for (final chat
              in chatsByProject[project.projectRoot] ?? const <ChatRow>[])
            WorkspaceSidebarEntry.chat(chat),
        ],
      ),
  ];
}

List<WorkspaceSidebarSection> _byRecent(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
) {
  final chats = _allChats(chatsByProject)
    ..sort((a, b) => b.lastActivityAt.compareTo(a.lastActivityAt));
  return [
    WorkspaceSidebarSection(
      id: 'recent:chats',
      title: 'Recent chats',
      entries: [for (final chat in chats) WorkspaceSidebarEntry.chat(chat)],
    ),
    WorkspaceSidebarSection(
      id: 'recent:projects',
      title: 'Projects',
      entries: [
        for (final project in projects) WorkspaceSidebarEntry.project(project),
      ],
    ),
  ];
}

List<WorkspaceSidebarSection> _byPinned(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
  WorkspaceSidebarSettings settings,
) {
  // Pinned chats stay grouped under their own project's row. Flattening all
  // pinned chats after all pinned projects made every pinned chat read as a
  // child of whichever pinned project happened to render last.
  final pinnedEntries = <WorkspaceSidebarEntry>[];
  final otherEntries = <WorkspaceSidebarEntry>[];
  for (final project in projects) {
    final chats = chatsByProject[project.projectRoot] ?? const <ChatRow>[];
    final projectPinned =
        settings.pinnedProjectRoots.contains(project.projectRoot);
    final pinnedChats = [
      for (final chat in chats)
        if (settings.pinnedChatIds.contains(chat.chatId)) chat,
    ];
    final otherChats = [
      for (final chat in chats)
        if (!settings.pinnedChatIds.contains(chat.chatId)) chat,
    ];
    if (projectPinned || pinnedChats.isNotEmpty) {
      pinnedEntries
        ..add(WorkspaceSidebarEntry.project(project))
        ..addAll(pinnedChats.map(WorkspaceSidebarEntry.chat));
    }
    if (!projectPinned || otherChats.isNotEmpty) {
      otherEntries
        ..add(WorkspaceSidebarEntry.project(project))
        ..addAll(otherChats.map(WorkspaceSidebarEntry.chat));
    }
  }
  return [
    WorkspaceSidebarSection(
      id: 'pinned',
      title: 'Pinned',
      entries: pinnedEntries,
    ),
    WorkspaceSidebarSection(
      id: 'unpinned',
      title: 'Other',
      entries: otherEntries,
    ),
  ];
}

List<WorkspaceSidebarSection> _byChatField({
  required String idPrefix,
  required String Function(ChatRow chat) titleFor,
  required Map<String, List<ChatRow>> chatsByProject,
  required List<ProjectRow> projects,
}) {
  final grouped = <String, List<ChatRow>>{};
  for (final chat in _allChats(chatsByProject)) {
    grouped.putIfAbsent(titleFor(chat), () => []).add(chat);
  }
  final titles = grouped.keys.toList()..sort();
  return [
    for (final title in titles)
      WorkspaceSidebarSection(
        id: '$idPrefix:$title',
        title: title,
        entries: [
          for (final chat in grouped[title]!) WorkspaceSidebarEntry.chat(chat),
        ],
      ),
    WorkspaceSidebarSection(
      id: '$idPrefix:projects',
      title: 'Projects',
      entries: [
        for (final project in projects) WorkspaceSidebarEntry.project(project),
      ],
    ),
  ];
}

List<WorkspaceSidebarSection> _byStatus(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
) {
  // Archived is filtered out upstream; an always-empty section would only
  // add noise here.
  const statuses = [
    ChatTaskStatus.active,
    ChatTaskStatus.waiting,
    ChatTaskStatus.done,
  ];
  final grouped = <ChatTaskStatus, List<ChatRow>>{
    for (final status in statuses) status: <ChatRow>[],
  };
  for (final chat in _allChats(chatsByProject)) {
    grouped[chat.taskStatus]?.add(chat);
  }
  return [
    for (final status in statuses)
      WorkspaceSidebarSection(
        id: 'status:${status.name}',
        title: status.displayName,
        entries: [
          for (final chat in grouped[status]!) WorkspaceSidebarEntry.chat(chat),
        ],
      ),
    WorkspaceSidebarSection(
      id: 'status:projects',
      title: 'Projects',
      entries: [
        for (final project in projects) WorkspaceSidebarEntry.project(project),
      ],
    ),
  ];
}

List<WorkspaceSidebarSection> _byLabel(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
) {
  final grouped = <String, List<ChatRow>>{};
  for (final chat in _allChats(chatsByProject)) {
    final labels = chat.taskLabels;
    if (labels.isEmpty) {
      grouped.putIfAbsent('No label', () => []).add(chat);
    } else {
      for (final label in labels) {
        grouped.putIfAbsent(label, () => []).add(chat);
      }
    }
  }
  final titles = grouped.keys.toList()..sort();
  return [
    for (final title in titles)
      WorkspaceSidebarSection(
        id: 'label:${Uri.encodeComponent(title)}',
        title: title,
        entries: [
          for (final chat in grouped[title]!) WorkspaceSidebarEntry.chat(chat),
        ],
      ),
    WorkspaceSidebarSection(
      id: 'label:projects',
      title: 'Projects',
      entries: [
        for (final project in projects) WorkspaceSidebarEntry.project(project),
      ],
    ),
  ];
}

List<WorkspaceSidebarSection> _byCustom(
  List<ProjectRow> projects,
  Map<String, List<ChatRow>> chatsByProject,
  WorkspaceSidebarSettings settings,
) {
  final grouped = <String, List<ChatRow>>{};
  for (final chat in _allChats(chatsByProject)) {
    final group = settings.customChatGroups[chat.chatId] ?? 'Ungrouped';
    grouped.putIfAbsent(group, () => []).add(chat);
  }
  final titles = grouped.keys.toList()..sort();
  return [
    for (final title in titles)
      WorkspaceSidebarSection(
        id: 'custom:${Uri.encodeComponent(title)}',
        title: title,
        entries: [
          for (final chat in grouped[title]!) WorkspaceSidebarEntry.chat(chat),
        ],
      ),
    WorkspaceSidebarSection(
      id: 'custom:projects',
      title: 'Projects',
      entries: [
        for (final project in projects) WorkspaceSidebarEntry.project(project),
      ],
    ),
  ];
}

List<ChatRow> _allChats(Map<String, List<ChatRow>> chatsByProject) {
  return [
    for (final chats in chatsByProject.values)
      for (final chat in chats) chat,
  ];
}

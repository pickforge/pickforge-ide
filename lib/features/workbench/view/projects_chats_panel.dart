import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/gitignore_helper.dart';
import 'package:pickforge/core/settings/workspace_sidebar_settings.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_sections.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ProjectsChatsPanel extends StatelessWidget {
  const ProjectsChatsPanel({
    super.key,
    this.pickFolder,
    this.gitignoreHelper,
  });

  /// Override for tests.
  final Future<String?> Function()? pickFolder;
  final GitignoreHelper? gitignoreHelper;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SectionHeader(
            label: l10n.workbenchProjectsHeader,
            tooltip: l10n.workbenchAddProject,
            onAdd: () => _onAddProject(context),
          ),
          const _SidebarToolbar(),
          Expanded(
            child: FocusTraversalGroup(
              child: Shortcuts(
                shortcuts: const {
                  SingleActivator(LogicalKeyboardKey.arrowDown):
                      NextFocusIntent(),
                  SingleActivator(LogicalKeyboardKey.arrowUp):
                      PreviousFocusIntent(),
                },
                child: Actions(
                  actions: {
                    NextFocusIntent: CallbackAction<NextFocusIntent>(
                      onInvoke: (_) {
                        FocusManager.instance.primaryFocus?.nextFocus();
                        return null;
                      },
                    ),
                    PreviousFocusIntent: CallbackAction<PreviousFocusIntent>(
                      onInvoke: (_) {
                        FocusManager.instance.primaryFocus?.previousFocus();
                        return null;
                      },
                    ),
                  },
                  child: _ProjectsTree(
                    l10n: l10n,
                    gitignoreHelper: gitignoreHelper ?? const GitignoreHelper(),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _onAddProject(BuildContext context) async {
    final picker = pickFolder ?? getDirectoryPath;
    final picked = await picker();
    if (picked == null) return;
    if (!context.mounted) return;
    await context.read<ProjectsCubit>().add(picked);
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.label,
    required this.tooltip,
    required this.onAdd,
  });

  final String label;
  final String tooltip;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 4, 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label.toUpperCase(),
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ),
          IconButton(
            tooltip: tooltip,
            icon: const Icon(Icons.add, size: 16),
            onPressed: onAdd,
          ),
        ],
      ),
    );
  }
}

class _SidebarToolbar extends StatelessWidget {
  const _SidebarToolbar();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocBuilder<WorkspaceSidebarCubit, WorkspaceSidebarState>(
      builder: (context, state) {
        final cubit = context.read<WorkspaceSidebarCubit>();
        return Padding(
          padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      decoration: InputDecoration(
                        hintText: l10n.sidebarSearch,
                        isDense: true,
                        prefixIcon: const Icon(Icons.search, size: 16),
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: cubit.setSearchQuery,
                    ),
                  ),
                  const SizedBox(width: 8),
                  ToggleButtons(
                    constraints: const BoxConstraints(
                      minWidth: 36,
                      minHeight: 36,
                    ),
                    isSelected: [
                      state.settings.viewMode == WorkspaceSidebarViewMode.list,
                      state.settings.viewMode == WorkspaceSidebarViewMode.grid,
                    ],
                    onPressed: (index) => cubit.setViewMode(
                      index == 0
                          ? WorkspaceSidebarViewMode.list
                          : WorkspaceSidebarViewMode.grid,
                    ),
                    children: [
                      Tooltip(
                        message: l10n.sidebarListMode,
                        child: const Icon(Icons.view_list, size: 16),
                      ),
                      Tooltip(
                        message: l10n.sidebarGridMode,
                        child: const Icon(Icons.grid_view, size: 16),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child:
                        DropdownButtonFormField<WorkspaceSidebarGroupingMode>(
                      initialValue: state.settings.groupingMode,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 8,
                        ),
                      ),
                      items: [
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.project,
                          child: Text(l10n.sidebarGroupProject),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.recentActivity,
                          child: Text(l10n.sidebarGroupRecent),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.pinned,
                          child: Text(l10n.sidebarGroupPinned),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.agent,
                          child: Text(l10n.sidebarGroupAgent),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.skill,
                          child: Text(l10n.sidebarGroupSkill),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.custom,
                          child: Text(l10n.sidebarGroupCustom),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) cubit.setGroupingMode(value);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    tooltip: state.settings.density ==
                            WorkspaceSidebarDensity.compact
                        ? 'Comfortable density'
                        : 'Compact density',
                    icon: Icon(
                      state.settings.density == WorkspaceSidebarDensity.compact
                          ? Icons.density_medium
                          : Icons.density_small,
                      size: 16,
                    ),
                    onPressed: () => cubit.setDensity(
                      state.settings.density == WorkspaceSidebarDensity.compact
                          ? WorkspaceSidebarDensity.comfortable
                          : WorkspaceSidebarDensity.compact,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ProjectsTree extends StatelessWidget {
  const _ProjectsTree({required this.l10n, required this.gitignoreHelper});

  final AppLocalizations l10n;
  final GitignoreHelper gitignoreHelper;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ProjectsCubit, ProjectsState>(
      builder: (context, projectsState) {
        if (projectsState is ProjectsError) {
          return _Empty(text: projectsState.message);
        }
        if (projectsState is! ProjectsReady || projectsState.projects.isEmpty) {
          return _Empty(text: l10n.workbenchNoProjects);
        }
        return BlocBuilder<ChatsCubit, ChatsState>(
          builder: (context, chatsState) {
            final ready = chatsState is ChatsReady ? chatsState : null;
            final activeId = ready?.activeChatId;
            final byProject = ready?.chatsByProject ?? const {};
            return BlocBuilder<WorkspaceSidebarCubit, WorkspaceSidebarState>(
              builder: (context, sidebarState) {
                final sections = buildWorkspaceSidebarSections(
                  projects: projectsState.projects,
                  chatsByProject: byProject,
                  settings: sidebarState.settings,
                  query: sidebarState.searchQuery,
                );
                if (sidebarState.settings.viewMode ==
                    WorkspaceSidebarViewMode.grid) {
                  return _ProjectsGrid(
                    sections: sections,
                    activeProjectRoot: projectsState.activeProjectRoot,
                    activeChatId: activeId,
                    l10n: l10n,
                    onAddChat: (root) => unawaited(_onAddChat(context, root)),
                    onSelectChat: (chat) =>
                        unawaited(_onSelectChat(context, chat)),
                  );
                }
                return _ProjectsList(
                  sections: sections,
                  activeProjectRoot: projectsState.activeProjectRoot,
                  activeChatId: activeId,
                  l10n: l10n,
                  onAddChat: (root) => unawaited(_onAddChat(context, root)),
                  onSelectChat: (chat) =>
                      unawaited(_onSelectChat(context, chat)),
                );
              },
            );
          },
        );
      },
    );
  }

  Future<void> _onAddChat(BuildContext context, String projectRoot) async {
    final cubit = context.read<ChatsCubit>();
    await cubit.newChat(
      projectRoot: projectRoot,
      defaultAgentId: 'claude-code',
    );
    if (!context.mounted) return;
    if (await gitignoreHelper.needsEntry(projectRoot)) {
      if (!context.mounted) return;
      final confirmed = await _askGitignore(context);
      if (confirmed == true) {
        await gitignoreHelper.appendEntry(projectRoot);
      }
    }
  }

  Future<void> _onSelectChat(BuildContext context, ChatRow chat) async {
    await context.read<ProjectsCubit>().selectProject(chat.projectRoot);
    if (!context.mounted) return;
    await context.read<ChatsCubit>().selectChat(chat.chatId);
  }

  Future<bool?> _askGitignore(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.gitignoreDialogTitle),
        content: Text(l10n.gitignoreDialogMessage),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(l10n.gitignoreDialogSkip),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(l10n.gitignoreDialogConfirm),
          ),
        ],
      ),
    );
  }
}

class _ProjectsList extends StatelessWidget {
  const _ProjectsList({
    required this.sections,
    required this.activeProjectRoot,
    required this.activeChatId,
    required this.l10n,
    required this.onAddChat,
    required this.onSelectChat,
  });

  final List<WorkspaceSidebarSection> sections;
  final String? activeProjectRoot;
  final String? activeChatId;
  final AppLocalizations l10n;
  final void Function(String projectRoot) onAddChat;
  final void Function(ChatRow chat) onSelectChat;

  @override
  Widget build(BuildContext context) {
    final sidebar = context.watch<WorkspaceSidebarCubit>().state.settings;
    final tiles = <Widget>[];
    for (var i = 0; i < sections.length; i++) {
      final section = sections[i];
      final collapsed = sidebar.collapsedGroupIds.contains(section.id);
      if (i > 0) {
        tiles.add(
          const Padding(
            padding: EdgeInsets.fromLTRB(8, 8, 8, 8),
            child: Divider(height: 1, thickness: 1),
          ),
        );
      }
      if (section.project case final project?) {
        tiles.add(
          _ProjectHeaderTile(
            project: project,
            expanded: !collapsed,
            isActiveProject: project.projectRoot == activeProjectRoot,
            isPinned: sidebar.pinnedProjectRoots.contains(project.projectRoot),
            onToggle: () => context
                .read<WorkspaceSidebarCubit>()
                .toggleGroupCollapsed(section.id),
            onPin: () => context
                .read<WorkspaceSidebarCubit>()
                .toggleProjectPinned(project.projectRoot),
            onAddChat: () => onAddChat(project.projectRoot),
          ),
        );
        if (!collapsed) {
          if (section.entries.isEmpty) {
            tiles.add(_EmptyChatHint(text: l10n.workbenchNoChats));
          } else {
            for (final entry in section.entries) {
              tiles.add(
                _SidebarEntryTile(
                  entry: entry,
                  activeProjectRoot: activeProjectRoot,
                  activeChatId: activeChatId,
                  onSelectChat: onSelectChat,
                ),
              );
            }
          }
        }
      } else {
        tiles.add(
          _GroupHeaderTile(
            title: section.title,
            expanded: !collapsed,
            onToggle: () => context
                .read<WorkspaceSidebarCubit>()
                .toggleGroupCollapsed(section.id),
          ),
        );
        if (!collapsed) {
          for (final entry in section.entries) {
            tiles.add(
              _SidebarEntryTile(
                entry: entry,
                activeProjectRoot: activeProjectRoot,
                activeChatId: activeChatId,
                onSelectChat: onSelectChat,
              ),
            );
          }
        }
      }
    }
    return ListView(children: tiles);
  }
}

class _ProjectsGrid extends StatelessWidget {
  const _ProjectsGrid({
    required this.sections,
    required this.activeProjectRoot,
    required this.activeChatId,
    required this.l10n,
    required this.onAddChat,
    required this.onSelectChat,
  });

  final List<WorkspaceSidebarSection> sections;
  final String? activeProjectRoot;
  final String? activeChatId;
  final AppLocalizations l10n;
  final void Function(String projectRoot) onAddChat;
  final void Function(ChatRow chat) onSelectChat;

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<WorkspaceSidebarCubit>().state.settings;
    final childAspectRatio =
        settings.density == WorkspaceSidebarDensity.compact ? 1.9 : 1.55;
    return ListView(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
      children: [
        for (final section in sections) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    section.title,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
                if (section.project case final project?)
                  IconButton(
                    tooltip: l10n.workbenchNewChat,
                    icon: const Icon(Icons.add, size: 16),
                    onPressed: () => onAddChat(project.projectRoot),
                  ),
              ],
            ),
          ),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            mainAxisSpacing: 6,
            crossAxisSpacing: 6,
            childAspectRatio: childAspectRatio,
            children: [
              if (section.project case final project?)
                _ProjectGridCard(
                  project: project,
                  isActive: project.projectRoot == activeProjectRoot,
                ),
              for (final entry in section.entries)
                _EntryGridCard(
                  entry: entry,
                  activeProjectRoot: activeProjectRoot,
                  activeChatId: activeChatId,
                  onSelectChat: onSelectChat,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _GroupHeaderTile extends StatelessWidget {
  const _GroupHeaderTile({
    required this.title,
    required this.expanded,
    required this.onToggle,
  });

  final String title;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ListTile(
      dense: true,
      leading: Icon(
        expanded ? Icons.expand_more : Icons.chevron_right,
        size: 18,
        color: cs.onSurfaceVariant,
      ),
      title: Text(
        title,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.bodySmall,
      ),
      onTap: onToggle,
    );
  }
}

class _ProjectHeaderTile extends StatelessWidget {
  const _ProjectHeaderTile({
    required this.project,
    required this.expanded,
    required this.isActiveProject,
    required this.isPinned,
    required this.onToggle,
    required this.onPin,
    required this.onAddChat,
  });

  final ProjectRow project;
  final bool expanded;
  final bool isActiveProject;
  final bool isPinned;
  final VoidCallback onToggle;
  final VoidCallback onPin;
  final VoidCallback onAddChat;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 2, 6, 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            onToggle();
            unawaited(
              _selectProjectOnly(context, project.projectRoot),
            );
          },
          hoverColor: cs.onSurface.withValues(alpha: 0.06),
          splashColor: cs.onSurface.withValues(alpha: 0.10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              children: [
                Icon(
                  expanded ? Icons.expand_more : Icons.chevron_right,
                  size: 18,
                  color: cs.onSurfaceVariant,
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    project.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight:
                          isActiveProject ? FontWeight.w600 : FontWeight.normal,
                      color: isActiveProject ? cs.primary : cs.onSurface,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: AppLocalizations.of(context).workbenchNewChat,
                  icon: const Icon(Icons.add, size: 16),
                  visualDensity: VisualDensity.compact,
                  onPressed: onAddChat,
                ),
                IconButton(
                  tooltip: isPinned
                      ? AppLocalizations.of(context).sidebarUnpin
                      : AppLocalizations.of(context).sidebarPin,
                  icon: Icon(
                    isPinned ? Icons.push_pin : Icons.push_pin_outlined,
                    size: 16,
                  ),
                  visualDensity: VisualDensity.compact,
                  onPressed: onPin,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SidebarEntryTile extends StatelessWidget {
  const _SidebarEntryTile({
    required this.entry,
    required this.activeProjectRoot,
    required this.activeChatId,
    required this.onSelectChat,
  });

  final WorkspaceSidebarEntry entry;
  final String? activeProjectRoot;
  final String? activeChatId;
  final void Function(ChatRow chat) onSelectChat;

  @override
  Widget build(BuildContext context) {
    return switch (entry.kind) {
      WorkspaceSidebarEntryKind.project => _ProjectEntryTile(
          project: entry.project!,
          isActive: entry.project!.projectRoot == activeProjectRoot,
        ),
      WorkspaceSidebarEntryKind.chat => _ChatTile(
          chat: entry.chat!,
          isActive: entry.chat!.chatId == activeChatId,
          isPinned: context
              .watch<WorkspaceSidebarCubit>()
              .state
              .settings
              .pinnedChatIds
              .contains(entry.chat!.chatId),
          customGroup: context
              .watch<WorkspaceSidebarCubit>()
              .state
              .settings
              .customChatGroups[entry.chat!.chatId],
          onPin: () => context
              .read<WorkspaceSidebarCubit>()
              .toggleChatPinned(entry.chat!.chatId),
          onSetCustomGroup: (group) => context
              .read<WorkspaceSidebarCubit>()
              .setChatCustomGroup(entry.chat!.chatId, group),
          onTap: () => onSelectChat(entry.chat!),
        ),
    };
  }
}

class _ProjectEntryTile extends StatelessWidget {
  const _ProjectEntryTile({required this.project, required this.isActive});

  final ProjectRow project;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 1, 6, 1),
      child: Material(
        color:
            isActive ? cs.primary.withValues(alpha: 0.12) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () =>
              unawaited(_selectProjectOnly(context, project.projectRoot)),
          hoverColor: cs.onSurface.withValues(alpha: 0.06),
          splashColor: cs.onSurface.withValues(alpha: 0.10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 16),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    project.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isActive ? cs.primary : cs.onSurface,
                      fontWeight:
                          isActive ? FontWeight.w500 : FontWeight.normal,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ChatTile extends StatelessWidget {
  const _ChatTile({
    required this.chat,
    required this.isActive,
    required this.isPinned,
    required this.customGroup,
    required this.onPin,
    required this.onSetCustomGroup,
    required this.onTap,
  });

  final ChatRow chat;
  final bool isActive;
  final bool isPinned;
  final String? customGroup;
  final VoidCallback onPin;
  final void Function(String? group) onSetCustomGroup;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(22, 1, 6, 1),
      child: Material(
        color:
            isActive ? cs.primary.withValues(alpha: 0.12) : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          hoverColor: cs.onSurface.withValues(alpha: 0.06),
          splashColor: cs.onSurface.withValues(alpha: 0.10),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    chat.title,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isActive ? cs.primary : cs.onSurface,
                      fontWeight:
                          isActive ? FontWeight.w500 : FontWeight.normal,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: isPinned
                      ? AppLocalizations.of(context).sidebarUnpin
                      : AppLocalizations.of(context).sidebarPin,
                  icon: Icon(
                    isPinned ? Icons.push_pin : Icons.push_pin_outlined,
                    size: 14,
                  ),
                  visualDensity: VisualDensity.compact,
                  onPressed: onPin,
                ),
                PopupMenuButton<_ChatAction>(
                  tooltip: MaterialLocalizations.of(context).showMenuTooltip,
                  icon: const Icon(Icons.more_horiz, size: 14),
                  onSelected: (action) async {
                    switch (action) {
                      case _ChatAction.setGroup:
                        final group = await _askCustomGroup(
                          context,
                          initialValue: customGroup,
                        );
                        if (group != null) onSetCustomGroup(group);
                      case _ChatAction.clearGroup:
                        onSetCustomGroup(null);
                    }
                  },
                  itemBuilder: (context) => [
                    PopupMenuItem(
                      value: _ChatAction.setGroup,
                      child: Text(
                        AppLocalizations.of(context).sidebarSetCustomGroup,
                      ),
                    ),
                    PopupMenuItem(
                      value: _ChatAction.clearGroup,
                      child: Text(
                        AppLocalizations.of(context).sidebarClearCustomGroup,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProjectGridCard extends StatelessWidget {
  const _ProjectGridCard({required this.project, required this.isActive});

  final ProjectRow project;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return _SidebarCard(
      icon: Icons.folder_outlined,
      title: project.displayName,
      selected: isActive,
      onTap: () => unawaited(_selectProjectOnly(context, project.projectRoot)),
    );
  }
}

class _EntryGridCard extends StatelessWidget {
  const _EntryGridCard({
    required this.entry,
    required this.activeProjectRoot,
    required this.activeChatId,
    required this.onSelectChat,
  });

  final WorkspaceSidebarEntry entry;
  final String? activeProjectRoot;
  final String? activeChatId;
  final void Function(ChatRow chat) onSelectChat;

  @override
  Widget build(BuildContext context) {
    return switch (entry.kind) {
      WorkspaceSidebarEntryKind.project => _SidebarCard(
          icon: Icons.folder_outlined,
          title: entry.project!.displayName,
          selected: entry.project!.projectRoot == activeProjectRoot,
          onTap: () => unawaited(
            _selectProjectOnly(context, entry.project!.projectRoot),
          ),
        ),
      WorkspaceSidebarEntryKind.chat => _SidebarCard(
          icon: Icons.chat_bubble_outline,
          title: entry.chat!.title,
          selected: entry.chat!.chatId == activeChatId,
          onTap: () => onSelectChat(entry.chat!),
        ),
    };
  }
}

class _SidebarCard extends StatelessWidget {
  const _SidebarCard({
    required this.icon,
    required this.title,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Material(
      color: selected
          ? cs.primary.withValues(alpha: 0.12)
          : cs.surfaceContainerHighest.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 18, color: selected ? cs.primary : null),
              const SizedBox(height: 6),
              Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: selected ? cs.primary : cs.onSurface,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum _ChatAction { setGroup, clearGroup }

Future<String?> _askCustomGroup(
  BuildContext context, {
  required String? initialValue,
}) {
  final controller = TextEditingController(text: initialValue ?? '');
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(AppLocalizations.of(ctx).sidebarCustomGroupTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(
          labelText: AppLocalizations.of(ctx).sidebarCustomGroupLabel,
        ),
        onSubmitted: (_) => Navigator.of(ctx).pop(controller.text),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text(MaterialLocalizations.of(ctx).cancelButtonLabel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(ctx).pop(controller.text),
          child: Text(AppLocalizations.of(ctx).sidebarSave),
        ),
      ],
    ),
  ).whenComplete(controller.dispose);
}

Future<void> _selectProjectOnly(
  BuildContext context,
  String projectRoot,
) async {
  await context.read<ProjectsCubit>().selectProject(projectRoot);
  if (!context.mounted) return;
  await context.read<ChatsCubit>().activateProject(projectRoot);
}

class _EmptyChatHint extends StatelessWidget {
  const _EmptyChatHint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(30, 4, 12, 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}

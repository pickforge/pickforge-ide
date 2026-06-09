import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
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
import 'package:pickforge/shared/components/components.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

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
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.md,
        PickforgeSpacing.md,
        PickforgeSpacing.xs,
        PickforgeSpacing.sm - 2,
      ),
      child: Row(
        children: [
          Expanded(child: MonoEyebrow(label, tick: true)),
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
                          value: WorkspaceSidebarGroupingMode.status,
                          child: Text(l10n.sidebarGroupStatus),
                        ),
                        DropdownMenuItem(
                          value: WorkspaceSidebarGroupingMode.label,
                          child: Text(l10n.sidebarGroupLabel),
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
                        ? l10n.sidebarComfortableDensity
                        : l10n.sidebarCompactDensity,
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
            padding: EdgeInsets.all(PickforgeSpacing.sm),
            child: Divider(
              height: 1,
              thickness: 1,
              color: PickforgeColors.hairline,
            ),
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
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.sm,
        0,
        PickforgeSpacing.sm,
        PickforgeSpacing.sm,
      ),
      children: [
        for (final section in sections) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(
              PickforgeSpacing.xs,
              PickforgeSpacing.md,
              PickforgeSpacing.xs,
              PickforgeSpacing.sm - 2,
            ),
            child: Row(
              children: [
                Expanded(
                  child: MonoEyebrow(section.title),
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
            mainAxisSpacing: PickforgeSpacing.sm - 2,
            crossAxisSpacing: PickforgeSpacing.sm - 2,
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
    return ListTile(
      dense: true,
      leading: Icon(
        expanded ? Icons.expand_more : Icons.chevron_right,
        size: 18,
        color: PickforgeColors.textMed,
      ),
      title: MonoEyebrow(title),
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.sm - 2,
        2,
        PickforgeSpacing.sm - 2,
        2,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            onToggle();
            unawaited(
              _selectProjectOnly(context, project.projectRoot),
            );
          },
          hoverColor: PickforgeColors.hairline,
          splashColor: PickforgeColors.hairlineStrong,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.xs,
              vertical: PickforgeSpacing.xs,
            ),
            child: Row(
              children: [
                Icon(
                  expanded ? Icons.expand_more : Icons.chevron_right,
                  size: 18,
                  color: PickforgeColors.textMed,
                ),
                const SizedBox(width: PickforgeSpacing.xs),
                Expanded(
                  child: Text(
                    project.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight:
                          isActiveProject ? FontWeight.w600 : FontWeight.normal,
                      color: isActiveProject
                          ? PickforgeColors.ember
                          : PickforgeColors.textHi,
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
          onSetStatus: (status) => unawaited(
            context.read<ChatsCubit>().setTaskStatus(
                  entry.chat!.chatId,
                  status,
                ),
          ),
          onSetTaskBrief: (brief) => unawaited(
            context.read<ChatsCubit>().setTaskBrief(
                  entry.chat!.chatId,
                  brief,
                ),
          ),
          onSetLabels: (labels) => unawaited(
            context.read<ChatsCubit>().setLabels(
                  entry.chat!.chatId,
                  labels,
                ),
          ),
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.xl - 2,
        1,
        PickforgeSpacing.sm - 2,
        1,
      ),
      child: Material(
        color: isActive ? PickforgeColors.surface2 : Colors.transparent,
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () =>
              unawaited(_selectProjectOnly(context, project.projectRoot)),
          hoverColor: PickforgeColors.hairline,
          splashColor: PickforgeColors.hairlineStrong,
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.md,
              vertical: PickforgeSpacing.sm - 2,
            ),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 16),
                const SizedBox(width: PickforgeSpacing.sm),
                Expanded(
                  child: Text(
                    project.displayName,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isActive
                          ? PickforgeColors.ember
                          : PickforgeColors.textHi,
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
    required this.onSetStatus,
    required this.onSetTaskBrief,
    required this.onSetLabels,
    required this.onTap,
  });

  final ChatRow chat;
  final bool isActive;
  final bool isPinned;
  final String? customGroup;
  final VoidCallback onPin;
  final void Function(String? group) onSetCustomGroup;
  final void Function(ChatTaskStatus status) onSetStatus;
  final void Function(String? brief) onSetTaskBrief;
  final void Function(List<String> labels) onSetLabels;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final status = chat.taskStatus;
    final showStatus = status != ChatTaskStatus.active;
    final labels = chat.taskLabels;
    final brief = chat.taskBrief;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.xl - 2,
        1,
        PickforgeSpacing.sm - 2,
        1,
      ),
      child: SelectionBracket(
        active: isActive,
        child: AnimatedContainer(
          duration: ReduceMotion.duration(context, PickforgeMotion.fast),
          curve: PickforgeMotion.forge,
          decoration: BoxDecoration(
            color: isActive
                ? PickforgeColors.ember.withValues(alpha: 0.06)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
            border: Border(
              left: BorderSide(
                color: isActive ? PickforgeColors.ember : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: onTap,
              hoverColor: PickforgeColors.hairline,
              splashColor: PickforgeColors.hairlineStrong,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: PickforgeSpacing.md,
                  vertical: PickforgeSpacing.sm - 2,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  chat.title,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: isActive
                                        ? PickforgeColors.ember
                                        : PickforgeColors.textHi,
                                    fontWeight: isActive
                                        ? FontWeight.w500
                                        : FontWeight.normal,
                                  ),
                                ),
                              ),
                              if (showStatus) ...[
                                const SizedBox(width: PickforgeSpacing.sm - 2),
                                _TaskStatusChip(status: status),
                              ],
                            ],
                          ),
                          if (brief != null) ...[
                            const SizedBox(height: 3),
                            Text(
                              brief,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: PickforgeColors.textMed,
                              ),
                            ),
                          ],
                          if (labels.isNotEmpty) ...[
                            const SizedBox(height: PickforgeSpacing.xs),
                            _ChatLabelsRow(labels: labels),
                          ],
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: isPinned ? l10n.sidebarUnpin : l10n.sidebarPin,
                      icon: Icon(
                        isPinned ? Icons.push_pin : Icons.push_pin_outlined,
                        size: 14,
                      ),
                      visualDensity: VisualDensity.compact,
                      onPressed: onPin,
                    ),
                    PopupMenuButton<_ChatAction>(
                      tooltip:
                          MaterialLocalizations.of(context).showMenuTooltip,
                      icon: const Icon(Icons.more_horiz, size: 14),
                      onSelected: (action) async {
                        switch (action) {
                          case _ChatAction.setBrief:
                            final brief = await _askTaskBrief(
                              context,
                              initialValue: chat.taskBrief,
                            );
                            if (brief != null) onSetTaskBrief(brief);
                          case _ChatAction.setLabels:
                            final labels = await _askLabels(
                              context,
                              initialValue: chat.taskLabels,
                            );
                            if (labels != null) onSetLabels(labels);
                          case _ChatAction.setActive:
                            onSetStatus(ChatTaskStatus.active);
                          case _ChatAction.setWaiting:
                            onSetStatus(ChatTaskStatus.waiting);
                          case _ChatAction.setDone:
                            onSetStatus(ChatTaskStatus.done);
                          case _ChatAction.archive:
                            onSetStatus(ChatTaskStatus.archived);
                          case _ChatAction.restore:
                            onSetStatus(ChatTaskStatus.active);
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
                          value: _ChatAction.setBrief,
                          child: Text(l10n.sidebarSetTaskBrief),
                        ),
                        PopupMenuItem(
                          value: _ChatAction.setLabels,
                          child: Text(l10n.sidebarSetLabels),
                        ),
                        const PopupMenuDivider(),
                        PopupMenuItem(
                          value: _ChatAction.setActive,
                          child: Text(l10n.sidebarSetStatusActive),
                        ),
                        PopupMenuItem(
                          value: _ChatAction.setWaiting,
                          child: Text(l10n.sidebarSetStatusWaiting),
                        ),
                        PopupMenuItem(
                          value: _ChatAction.setDone,
                          child: Text(l10n.sidebarSetStatusDone),
                        ),
                        PopupMenuItem(
                          value: status == ChatTaskStatus.archived
                              ? _ChatAction.restore
                              : _ChatAction.archive,
                          child: Text(
                            status == ChatTaskStatus.archived
                                ? l10n.sidebarRestoreChat
                                : l10n.sidebarArchiveChat,
                          ),
                        ),
                        const PopupMenuDivider(),
                        PopupMenuItem(
                          value: _ChatAction.setGroup,
                          child: Text(
                            l10n.sidebarSetCustomGroup,
                          ),
                        ),
                        PopupMenuItem(
                          value: _ChatAction.clearGroup,
                          child: Text(
                            l10n.sidebarClearCustomGroup,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
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
          subtitle: entry.chat!.taskBrief,
          status: entry.chat!.taskStatus == ChatTaskStatus.active
              ? null
              : entry.chat!.taskStatus,
          labels: entry.chat!.taskLabels,
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
    this.subtitle,
    this.status,
    this.labels = const [],
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final ChatTaskStatus? status;
  final List<String> labels;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasMetadata = status != null || subtitle != null || labels.isNotEmpty;
    return SelectionBracket(
      active: selected,
      child: Material(
        color: selected ? PickforgeColors.surface2 : PickforgeColors.surface1,
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusMd),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          hoverColor: PickforgeColors.hairline,
          splashColor: PickforgeColors.hairlineStrong,
          child: Padding(
            padding: const EdgeInsets.all(PickforgeSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: hasMetadata
                  ? MainAxisAlignment.start
                  : MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    Icon(
                      icon,
                      size: 18,
                      color: selected
                          ? PickforgeColors.ember
                          : PickforgeColors.textMed,
                    ),
                    const Spacer(),
                    if (status case final status?)
                      Flexible(child: _TaskStatusChip(status: status)),
                  ],
                ),
                const SizedBox(height: PickforgeSpacing.sm - 2),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: selected
                        ? PickforgeColors.ember
                        : PickforgeColors.textHi,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: PickforgeColors.textMed,
                    ),
                  ),
                ],
                if (labels.isNotEmpty) ...[
                  const SizedBox(height: PickforgeSpacing.xs + 1),
                  _ChatLabelsRow(labels: labels, maxLabels: 2),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TaskStatusChip extends StatelessWidget {
  const _TaskStatusChip({required this.status});

  final ChatTaskStatus status;

  @override
  Widget build(BuildContext context) {
    final foreground = switch (status) {
      ChatTaskStatus.active => PickforgeColors.textMed,
      ChatTaskStatus.waiting => PickforgeColors.warning,
      ChatTaskStatus.done => PickforgeColors.connected,
      ChatTaskStatus.archived => PickforgeColors.textLow,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.sm - 2,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: foreground.withValues(alpha: 0.12),
        border: Border.all(color: PickforgeColors.hairline),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Text(
        _statusLabel(AppLocalizations.of(context), status),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: foreground,
              fontWeight: FontWeight.w600,
            ),
      ),
    );
  }
}

class _ChatLabelsRow extends StatelessWidget {
  const _ChatLabelsRow({
    required this.labels,
    this.maxLabels = 3,
  });

  final List<String> labels;
  final int maxLabels;

  @override
  Widget build(BuildContext context) {
    final visible = labels.take(maxLabels).toList(growable: false);
    final remaining = labels.length - visible.length;
    return Wrap(
      spacing: PickforgeSpacing.xs,
      runSpacing: PickforgeSpacing.xs,
      children: [
        for (final label in visible)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.sm - 2,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              border: Border.all(color: PickforgeColors.hairline),
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
            ),
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: PickforgeColors.textMed,
                  ),
            ),
          ),
        if (remaining > 0)
          Text(
            '+$remaining',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: PickforgeColors.textMed,
                ),
          ),
      ],
    );
  }
}

enum _ChatAction {
  setBrief,
  setLabels,
  setActive,
  setWaiting,
  setDone,
  archive,
  restore,
  setGroup,
  clearGroup,
}

String _statusLabel(AppLocalizations l10n, ChatTaskStatus status) {
  return switch (status) {
    ChatTaskStatus.active => l10n.sidebarStatusActive,
    ChatTaskStatus.waiting => l10n.sidebarStatusWaiting,
    ChatTaskStatus.done => l10n.sidebarStatusDone,
    ChatTaskStatus.archived => l10n.sidebarStatusArchived,
  };
}

Future<String?> _askTaskBrief(
  BuildContext context, {
  required String? initialValue,
}) {
  final controller = TextEditingController(text: initialValue ?? '');
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(AppLocalizations.of(ctx).sidebarTaskBriefTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        minLines: 1,
        maxLines: 3,
        decoration: InputDecoration(
          labelText: AppLocalizations.of(ctx).sidebarTaskBriefLabel,
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

Future<List<String>?> _askLabels(
  BuildContext context, {
  required List<String> initialValue,
}) {
  final controller = TextEditingController(text: initialValue.join(', '));
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(AppLocalizations.of(ctx).sidebarLabelsTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(
          labelText: AppLocalizations.of(ctx).sidebarLabelsLabel,
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
  )
      .then(
        (value) => value == null ? null : parseChatLabelInput(value),
      )
      .whenComplete(controller.dispose);
}

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
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.xl + PickforgeSpacing.sm - 2,
        PickforgeSpacing.xs,
        PickforgeSpacing.md,
        PickforgeSpacing.sm,
      ),
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
        padding: const EdgeInsets.all(PickforgeSpacing.xl),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}

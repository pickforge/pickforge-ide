import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/projects/gitignore_helper.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
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
          Expanded(
            child: _ProjectsTree(
              l10n: l10n,
              gitignoreHelper: gitignoreHelper ?? const GitignoreHelper(),
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
            final expanded = ready?.expanded ?? const <String>{};
            final byProject = ready?.chatsByProject ?? const {};

            final tiles = <Widget>[];
            for (var i = 0; i < projectsState.projects.length; i++) {
              final project = projectsState.projects[i];
              final isExpanded = expanded.contains(project.projectRoot);
              if (i > 0) {
                tiles.add(
                  const Padding(
                    padding: EdgeInsets.fromLTRB(8, 8, 8, 8),
                    child: Divider(height: 1, thickness: 1),
                  ),
                );
              }
              tiles.add(
                _ProjectHeaderTile(
                  project: project,
                  expanded: isExpanded,
                  isActiveProject:
                      project.projectRoot == projectsState.activeProjectRoot,
                  onToggle: () => context
                      .read<ChatsCubit>()
                      .toggleExpanded(project.projectRoot),
                  onAddChat: () => unawaited(
                    _onAddChat(context, project.projectRoot),
                  ),
                ),
              );
              if (isExpanded) {
                final chats = byProject[project.projectRoot] ?? const [];
                if (chats.isEmpty) {
                  tiles.add(_EmptyChatHint(text: l10n.workbenchNoChats));
                } else {
                  for (final chat in chats) {
                    tiles.add(
                      _ChatTile(
                        chat: chat,
                        isActive: chat.chatId == activeId,
                        onTap: () =>
                            context.read<ChatsCubit>().selectChat(chat.chatId),
                      ),
                    );
                  }
                }
              }
            }
            return ListView(children: tiles);
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

class _ProjectHeaderTile extends StatelessWidget {
  const _ProjectHeaderTile({
    required this.project,
    required this.expanded,
    required this.isActiveProject,
    required this.onToggle,
    required this.onAddChat,
  });

  final ProjectRow project;
  final bool expanded;
  final bool isActiveProject;
  final VoidCallback onToggle;
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
              context.read<ProjectsCubit>().selectProject(project.projectRoot),
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
    required this.onTap,
  });

  final ChatRow chat;
  final bool isActive;
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
            child: Text(
              chat.title,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: isActive ? cs.primary : cs.onSurface,
                fontWeight: isActive ? FontWeight.w500 : FontWeight.normal,
              ),
            ),
          ),
        ),
      ),
    );
  }
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

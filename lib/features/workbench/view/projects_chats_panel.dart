import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ProjectsChatsPanel extends StatelessWidget {
  const ProjectsChatsPanel({super.key, this.pickFolder});

  /// Override for tests.
  final Future<String?> Function()? pickFolder;

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
          Expanded(child: _ProjectsList(l10n: l10n)),
          const Divider(height: 1),
          _SectionHeader(
            label: l10n.workbenchChatsHeader,
            tooltip: l10n.workbenchNewChat,
            onAdd: () => _onAddChat(context),
          ),
          Expanded(child: _ChatsList(l10n: l10n)),
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

  Future<void> _onAddChat(BuildContext context) async {
    final projects = context.read<ProjectsCubit>().state;
    if (projects is! ProjectsReady || projects.activeProjectRoot == null) {
      return;
    }
    await context.read<ChatsCubit>().newChat(
          projectRoot: projects.activeProjectRoot!,
          defaultAgentId: 'claude-code',
        );
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

class _ProjectsList extends StatelessWidget {
  const _ProjectsList({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ProjectsCubit, ProjectsState>(
      builder: (context, state) {
        if (state is ProjectsReady && state.projects.isNotEmpty) {
          return ListView.builder(
            itemCount: state.projects.length,
            itemBuilder: (_, i) {
              final p = state.projects[i];
              return _ProjectTile(
                project: p,
                isActive: p.projectRoot == state.activeProjectRoot,
              );
            },
          );
        }
        if (state is ProjectsError) {
          return _Empty(text: state.message);
        }
        return _Empty(text: l10n.workbenchNoProjects);
      },
    );
  }
}

class _ProjectTile extends StatelessWidget {
  const _ProjectTile({required this.project, required this.isActive});

  final ProjectRow project;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      selected: isActive,
      title: Text(
        project.displayName,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: () => context.read<ProjectsCubit>().selectProject(
            project.projectRoot,
          ),
    );
  }
}

class _ChatsList extends StatelessWidget {
  const _ChatsList({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ChatsCubit, ChatsState>(
      builder: (context, state) {
        if (state is ChatsReady && state.chats.isNotEmpty) {
          return ListView.builder(
            itemCount: state.chats.length,
            itemBuilder: (_, i) {
              final c = state.chats[i];
              return ListTile(
                dense: true,
                selected: c.chatId == state.activeChatId,
                title: Text(c.title, overflow: TextOverflow.ellipsis),
                onTap: () => context.read<ChatsCubit>().selectChat(c.chatId),
              );
            },
          );
        }
        if (state is ChatsError) {
          return _Empty(text: state.message);
        }
        return _Empty(text: l10n.workbenchNoChats);
      },
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

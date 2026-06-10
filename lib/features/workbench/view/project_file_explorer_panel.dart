import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/projects/project_file_tree.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_cubit.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ProjectFileExplorerPanel extends StatelessWidget {
  const ProjectFileExplorerPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocBuilder<ProjectFileExplorerCubit, ProjectFileExplorerState>(
      builder: (context, state) {
        final visibleNodes = _filterNodes(state.nodes, state.query);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 8, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.explorerHeader.toUpperCase(),
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                  IconButton(
                    tooltip: state.showHidden
                        ? l10n.explorerHideHidden
                        : l10n.explorerShowHidden,
                    icon: Icon(
                      state.showHidden
                          ? Icons.visibility
                          : Icons.visibility_off,
                      size: 16,
                    ),
                    onPressed: () => unawaited(
                      context.read<ProjectFileExplorerCubit>().toggleHidden(),
                    ),
                  ),
                  IconButton(
                    tooltip: MaterialLocalizations.of(context)
                        .refreshIndicatorSemanticLabel,
                    icon: const Icon(Icons.refresh, size: 16),
                    onPressed: () => unawaited(
                      context.read<ProjectFileExplorerCubit>().load(),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 0, 10, 8),
              child: TextField(
                decoration: InputDecoration(
                  hintText: l10n.explorerSearch,
                  isDense: true,
                  prefixIcon: const Icon(Icons.search, size: 16),
                  border: const OutlineInputBorder(),
                ),
                onChanged: context.read<ProjectFileExplorerCubit>().setQuery,
              ),
            ),
            if (state.status == ProjectFileExplorerStatus.loading)
              const LinearProgressIndicator(minHeight: 1)
            else if (state.status == ProjectFileExplorerStatus.missingRoot)
              _ExplorerMessage(
                text: l10n.explorerMissingRoot(state.error ?? ''),
              )
            else if (state.status == ProjectFileExplorerStatus.error)
              _ExplorerMessage(text: state.error ?? 'Explorer failed')
            else if (visibleNodes.isEmpty)
              _ExplorerMessage(text: l10n.explorerEmpty)
            else ...[
              for (final node in visibleNodes)
                _FileNodeTile(
                  node: node,
                  depth: 0,
                  forceExpanded: state.query.trim().isNotEmpty,
                ),
            ],
          ],
        );
      },
    );
  }
}

class _FileNodeTile extends StatelessWidget {
  const _FileNodeTile({
    required this.node,
    required this.depth,
    required this.forceExpanded,
  });

  final ProjectFileNode node;
  final int depth;
  final bool forceExpanded;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<ProjectFileExplorerCubit>().state;
    final expanded = forceExpanded || state.expandedPaths.contains(node.path);
    final children = forceExpanded
        ? _filterNodes(node.children, state.query)
        : node.children;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: EdgeInsets.only(left: 8.0 + depth * 14),
          child: ListTile(
            dense: true,
            minVerticalPadding: 0,
            horizontalTitleGap: 6,
            leading: Icon(
              node.isDirectory
                  ? expanded
                      ? Icons.folder_open
                      : Icons.folder
                  : Icons.insert_drive_file_outlined,
              size: 16,
            ),
            title: Text(
              node.name,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            onTap: node.isDirectory
                ? () => context
                    .read<ProjectFileExplorerCubit>()
                    .toggleExpanded(node.path)
                : () => unawaited(_open(context, node.path)),
            trailing: _FileNodeMenu(node: node),
          ),
        ),
        if (node.isDirectory && expanded)
          for (final child in children)
            _FileNodeTile(
              node: child,
              depth: depth + 1,
              forceExpanded: forceExpanded,
            ),
      ],
    );
  }
}

class _FileNodeMenu extends StatelessWidget {
  const _FileNodeMenu({required this.node});

  final ProjectFileNode node;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PopupMenuButton<_FileAction>(
      tooltip: MaterialLocalizations.of(context).showMenuTooltip,
      icon: const Icon(Icons.more_horiz, size: 16),
      onSelected: (action) => switch (action) {
        _FileAction.open => unawaited(_open(context, node.path)),
        _FileAction.reveal => unawaited(_reveal(context, node.path)),
        _FileAction.attach => context.read<ContextAttachmentsCubit>().attach(
              node.path,
            ),
        _FileAction.copyRelative => unawaited(
            Clipboard.setData(ClipboardData(text: node.relativePath)),
          ),
        _FileAction.copyAbsolute => unawaited(
            Clipboard.setData(ClipboardData(text: node.path)),
          ),
      },
      itemBuilder: (context) => [
        PopupMenuItem(value: _FileAction.open, child: Text(l10n.explorerOpen)),
        PopupMenuItem(
          value: _FileAction.reveal,
          child: Text(l10n.explorerReveal),
        ),
        if (!node.isDirectory)
          PopupMenuItem(
            value: _FileAction.attach,
            child: Text(l10n.explorerAttachToForge),
          ),
        PopupMenuItem(
          value: _FileAction.copyRelative,
          child: Text(l10n.explorerCopyRelativePath),
        ),
        PopupMenuItem(
          value: _FileAction.copyAbsolute,
          child: Text(l10n.explorerCopyAbsolutePath),
        ),
      ],
    );
  }
}

class _ExplorerMessage extends StatelessWidget {
  const _ExplorerMessage({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Text(text, style: Theme.of(context).textTheme.bodySmall),
    );
  }
}

enum _FileAction { open, reveal, attach, copyRelative, copyAbsolute }

Future<void> _open(BuildContext context, String path) async {
  try {
    await context.read<ProjectFileExplorerCubit>().open(path);
  } on Object catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }
}

Future<void> _reveal(BuildContext context, String path) async {
  try {
    await context.read<ProjectFileExplorerCubit>().reveal(path);
  } on Object catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error.toString())),
    );
  }
}

List<ProjectFileNode> _filterNodes(List<ProjectFileNode> nodes, String query) {
  final normalized = query.trim().toLowerCase();
  if (normalized.isEmpty) return nodes;
  final filtered = <ProjectFileNode>[];
  for (final node in nodes) {
    final children = _filterNodes(node.children, query);
    final matches = node.name.toLowerCase().contains(normalized) ||
        node.relativePath.toLowerCase().contains(normalized);
    if (matches || children.isNotEmpty) {
      filtered.add(
        ProjectFileNode(
          path: node.path,
          relativePath: node.relativePath,
          name: node.name,
          isDirectory: node.isDirectory,
          children: children,
        ),
      );
    }
  }
  return filtered;
}

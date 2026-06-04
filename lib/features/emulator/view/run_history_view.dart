import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class RunHistoryView extends StatelessWidget {
  const RunHistoryView({super.key, this.historyStream, this.projectRoot});

  final Stream<List<RunSessionLogRow>>? historyStream;
  final String? projectRoot;

  @override
  Widget build(BuildContext context) {
    final root = projectRoot ?? _activeProjectRoot(context);
    final stream = historyStream ?? _historyStreamFor(root);
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: ColoredBox(
        color: colorScheme.surface,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _RunHistoryHeader(
              title: l10n.runHistoryTitle,
              subtitle: l10n.runHistorySubtitle,
            ),
            Divider(height: 1, color: colorScheme.outlineVariant),
            Expanded(
              child: root == null && historyStream == null
                  ? _RunHistoryEmpty(text: l10n.runHistoryNoProject)
                  : StreamBuilder<List<RunSessionLogRow>>(
                      stream: stream,
                      initialData: const [],
                      builder: (context, snapshot) {
                        final rows =
                            snapshot.data ?? const <RunSessionLogRow>[];
                        if (rows.isEmpty) {
                          return _RunHistoryEmpty(text: l10n.runHistoryEmpty);
                        }
                        return ListView.separated(
                          padding: const EdgeInsets.all(12),
                          itemCount: rows.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 8),
                          itemBuilder: (context, index) =>
                              _RunHistoryTile(row: rows[index], l10n: l10n),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String? _activeProjectRoot(BuildContext context) {
    try {
      return switch (context.read<ProjectsCubit>().state) {
        ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
        _ => null,
      };
    } on ProviderNotFoundException {
      return null;
    }
  }

  Stream<List<RunSessionLogRow>> _historyStreamFor(String? root) {
    if (root == null || !getIt.isRegistered<RunSessionLogRepository>()) {
      return Stream.value(const <RunSessionLogRow>[]);
    }
    return getIt<RunSessionLogRepository>().watchRecent(root);
  }
}

class _RunHistoryTile extends StatelessWidget {
  const _RunHistoryTile({required this.row, required this.l10n});

  final RunSessionLogRow row;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final title = row.avdName ?? row.serial ?? row.connectionMode;
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerLow,
        border: Border.all(color: colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          _MetaLine(text: l10n.runHistoryProject(row.projectRoot), mono: mono),
          _MetaLine(text: l10n.runHistorySession(row.sessionId), mono: mono),
          _MetaLine(text: l10n.runHistoryStarted(_formatDate(row.startedAt))),
          _MetaLine(
            text: l10n.runHistoryEnded(_formatNullableDate(row.endedAt)),
          ),
          _MetaLine(
            text: l10n.runHistoryTarget(
              row.targetFile ?? l10n.runHistoryDefaultTarget,
            ),
          ),
          _MetaLine(
            text: l10n.runHistoryVmService(
              row.vmServiceUrl ?? l10n.runHistoryNoVmService,
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              _MetricPill(
                text: l10n
                    .runHistoryExit(row.exitReason ?? l10n.runHistoryRunning),
              ),
              _MetricPill(
                text: l10n.runHistoryExitCode(
                  row.exitCode?.toString() ?? l10n.runHistoryNoVmService,
                ),
              ),
              _MetricPill(text: l10n.runHistoryHotReloads(row.hotReloadCount)),
              _MetricPill(
                text: l10n.runHistoryHotRestarts(row.hotRestartCount),
              ),
              _MetricPill(text: l10n.runHistoryErrors(row.errorCount)),
            ],
          ),
          if (row.lastError != null) ...[
            const SizedBox(height: 8),
            _MetaLine(text: l10n.runHistoryLastError(row.lastError!)),
          ],
        ],
      ),
    );
  }

  String _formatNullableDate(DateTime? value) {
    if (value == null) return l10n.runHistoryRunning;
    return _formatDate(value);
  }

  String _formatDate(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}

class _RunHistoryHeader extends StatelessWidget {
  const _RunHistoryHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 3),
          Text(
            subtitle,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.64),
                ),
          ),
        ],
      ),
    );
  }
}

class _RunHistoryEmpty extends StatelessWidget {
  const _RunHistoryEmpty({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          border:
              Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(text),
      ),
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.text, this.mono});

  final String text;
  final String? mono;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontFamily: mono, fontSize: 11),
      ),
    );
  }
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.44),
        border: Border.all(color: colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(text, style: Theme.of(context).textTheme.labelSmall),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class HistoryView extends StatelessWidget {
  const HistoryView({super.key, this.historyStream});

  final Stream<List<PickHistoryRow>>? historyStream;

  @override
  Widget build(BuildContext context) {
    final stream = historyStream ?? _historyStreamOrEmpty();
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: ColoredBox(
        color: colorScheme.surface,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _HistoryHeader(
              title: l10n.pickHistoryTitle,
              subtitle: l10n.pickHistorySubtitle,
            ),
            Divider(height: 1, color: colorScheme.outlineVariant),
            Expanded(
              child: StreamBuilder<List<PickHistoryRow>>(
                stream: stream,
                initialData: const [],
                builder: (context, snapshot) {
                  final rows = snapshot.data ?? const <PickHistoryRow>[];
                  if (rows.isEmpty) {
                    return _HistoryEmpty(text: l10n.pickHistoryEmpty);
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: rows.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, index) =>
                        _HistoryTile(row: rows[index], l10n: l10n),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Stream<List<PickHistoryRow>> _historyStreamOrEmpty() {
    if (!getIt.isRegistered<PickforgeDatabase>()) {
      return Stream.value(const <PickHistoryRow>[]);
    }
    return getIt<PickforgeDatabase>().pickHistoryDao.recent();
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.row, required this.l10n});

  final PickHistoryRow row;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final location = row.creationFile == null
        ? null
        : '${row.creationFile}:${row.creationLine ?? '?'}';
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
            row.widgetClass,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          _MetaLine(text: l10n.historyProject(row.projectRoot), mono: mono),
          if (location != null)
            _MetaLine(text: l10n.historyLocation(location), mono: mono),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              _MetaPill(text: l10n.historySkill(row.skillId)),
              _MetaPill(text: l10n.historyAgent(row.agentId)),
              _MetaPill(
                text: l10n.historyPicked(_formatPickedAt(row.pickedAt)),
              ),
              _MetaPill(
                text: l10n.historyChat(row.chatId ?? l10n.historyChatNone),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatPickedAt(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}

class _HistoryHeader extends StatelessWidget {
  const _HistoryHeader({required this.title, required this.subtitle});

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

class _HistoryEmpty extends StatelessWidget {
  const _HistoryEmpty({required this.text});

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

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.text});

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
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }
}

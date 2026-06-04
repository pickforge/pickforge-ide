import 'package:flutter/material.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/widget_picker/widgets/screenshot_preview.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class WidgetDetailsPanel extends StatelessWidget {
  const WidgetDetailsPanel({
    required this.selected,
    this.rebuildStats,
    super.key,
  });

  final SelectedWidget selected;
  final RebuildStats? rebuildStats;

  @override
  Widget build(BuildContext context) {
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Hero(
            tag: 'widget-${selected.node.id}',
            child: Text(
              selected.node.className,
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          const SizedBox(height: 8),
          if (selected.node.creationLocation != null)
            _CreationLocationBlock(
              location: selected.node.creationLocation!,
              mono: mono,
            ),
          const SizedBox(height: 8),
          _AncestorChain(ancestors: selected.ancestorClasses, mono: mono),
          const SizedBox(height: 16),
          ScreenshotPreview(path: selected.screenshotPath),
          if (rebuildStats case final stats? when stats.widgets.isNotEmpty)
            _RebuildStatsPanel(stats: stats, mono: mono),
          if (selected.sourceSnippet != null)
            _SourceSnippet(snippet: selected.sourceSnippet!, mono: mono),
        ],
      ),
    );
  }
}

class _RebuildStatsPanel extends StatelessWidget {
  const _RebuildStatsPanel({required this.stats, this.mono});

  final RebuildStats stats;
  final String? mono;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final widgets = stats.widgets.take(8).toList(growable: false);
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.48),
          border: Border.all(color: colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Recent rebuilds', style: textTheme.titleSmall),
            const SizedBox(height: 8),
            for (final widget in widgets)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _RebuildCountBadge(count: widget.count),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(widget.className, style: textTheme.bodyMedium),
                          Text(
                            _locationText(widget.location),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontFamily: mono, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _locationText(CreationLocation location) {
    return '${location.file}:${location.line}:${location.column}';
  }
}

class _RebuildCountBadge extends StatelessWidget {
  const _RebuildCountBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      constraints: const BoxConstraints(minWidth: 28),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'x$count',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: colorScheme.onPrimaryContainer,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _CreationLocationBlock extends StatelessWidget {
  const _CreationLocationBlock({required this.location, this.mono});

  final CreationLocation location;
  final String? mono;

  @override
  Widget build(BuildContext context) {
    return Text(
      '${location.file}:${location.line}:${location.column}',
      style: TextStyle(fontFamily: mono, fontSize: 12),
    );
  }
}

class _AncestorChain extends StatelessWidget {
  const _AncestorChain({required this.ancestors, this.mono});

  final List<String> ancestors;
  final String? mono;

  @override
  Widget build(BuildContext context) {
    if (ancestors.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Ancestors', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        Wrap(
          spacing: 4,
          children: [
            for (final a in ancestors)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  border: Border.all(color: Colors.grey.shade400),
                  borderRadius: BorderRadius.circular(4),
                ),
                child:
                    Text(a, style: TextStyle(fontFamily: mono, fontSize: 11)),
              ),
          ],
        ),
      ],
    );
  }
}

class _SourceSnippet extends StatelessWidget {
  const _SourceSnippet({required this.snippet, this.mono});

  final String snippet;
  final String? mono;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Source', style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 4),
        Container(
          width: double.infinity,
          constraints: const BoxConstraints(maxHeight: 300),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.grey.shade100,
            borderRadius: BorderRadius.circular(4),
          ),
          child: SingleChildScrollView(
            child: SelectableText(
              snippet,
              style: TextStyle(fontFamily: mono, fontSize: 11),
            ),
          ),
        ),
      ],
    );
  }
}

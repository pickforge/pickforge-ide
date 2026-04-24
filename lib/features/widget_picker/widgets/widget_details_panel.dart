import 'package:flutter/material.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/widget_picker/widgets/screenshot_preview.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class WidgetDetailsPanel extends StatelessWidget {
  const WidgetDetailsPanel({required this.selected, super.key});

  final SelectedWidget selected;

  @override
  Widget build(BuildContext context) {
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            selected.node.className,
            style: Theme.of(context).textTheme.titleLarge,
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
          if (selected.sourceSnippet != null)
            _SourceSnippet(snippet: selected.sourceSnippet!, mono: mono),
        ],
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

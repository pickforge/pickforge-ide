import 'package:flutter/material.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/widget_picker/widgets/widget_details_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class DemoWorkspaceView extends StatelessWidget {
  const DemoWorkspaceView({super.key});

  static const _projectRoot = '/demo/sample_flutter_app';

  static const _selection = SelectedWidget(
    node: WidgetNode(
      id: 'demo-counter-page',
      className: 'CounterPage',
      children: [
        WidgetNode(
          id: 'demo-count-text',
          className: 'Text',
          children: [],
          creationLocation: null,
        ),
        WidgetNode(
          id: 'demo-increment-button',
          className: 'FloatingActionButton',
          children: [],
          creationLocation: null,
        ),
      ],
      creationLocation: CreationLocation(
        file: 'lib/main.dart',
        line: 42,
        column: 12,
      ),
    ),
    ancestorClasses: ['MaterialApp', 'Scaffold', 'Center', 'Column'],
    sourceSnippet: r'''
class CounterPage extends StatelessWidget {
  const CounterPage({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('Count: $count'),
        FloatingActionButton(onPressed: () {}),
      ],
    );
  }
}
''',
    screenshotPath: null,
    adbScreenshotPath: null,
    propertiesJson: {
      'mainAxisSize': 'min',
      'children': 2,
    },
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth < 900) {
              return SingleChildScrollView(
                child: SizedBox(
                  width: constraints.maxWidth,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SizedBox(
                        height: 280,
                        child: _DemoNavigatorPane(l10n: l10n),
                      ),
                      const Divider(height: 1),
                      SizedBox(
                        height: 420,
                        child: _DemoTerminalPane(l10n: l10n),
                      ),
                      const Divider(height: 1),
                      SizedBox(
                        height: 720,
                        child: _DemoInspectorPane(l10n: l10n),
                      ),
                    ],
                  ),
                ),
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 280,
                  child: _DemoNavigatorPane(l10n: l10n),
                ),
                const VerticalDivider(width: 1),
                Expanded(
                  child: _DemoTerminalPane(l10n: l10n),
                ),
                const VerticalDivider(width: 1),
                SizedBox(
                  width: 360,
                  child: _DemoInspectorPane(l10n: l10n),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DemoNavigatorPane extends StatelessWidget {
  const _DemoNavigatorPane({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ColoredBox(
      color: cs.surfaceContainerLow,
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _PaneHeader(title: l10n.demoWorkspaceTitle),
            _SelectedTile(
              icon: Icons.folder_outlined,
              title: l10n.demoProjectName,
              subtitle: DemoWorkspaceView._projectRoot,
            ),
            _SelectedTile(
              icon: Icons.chat_bubble_outline,
              title: l10n.demoChatTitle,
              subtitle: l10n.demoAgentName,
            ),
            const Divider(height: 1),
            _PaneHeader(title: l10n.demoExplorerHeader),
            const _FileRow(depth: 0, icon: Icons.folder_open, label: 'lib'),
            const _FileRow(
              depth: 1,
              icon: Icons.description_outlined,
              label: 'main.dart',
            ),
            const _FileRow(
              depth: 0,
              icon: Icons.folder_open,
              label: '.pickforge',
            ),
            const _FileRow(
              depth: 1,
              icon: Icons.article_outlined,
              label: 'widget-context.md',
            ),
            const _FileRow(
              depth: 1,
              icon: Icons.article_outlined,
              label: 'initial-prompt.md',
            ),
          ],
        ),
      ),
    );
  }
}

class _DemoTerminalPane extends StatelessWidget {
  const _DemoTerminalPane({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    final cs = Theme.of(context).colorScheme;
    return ColoredBox(
      color: cs.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PaneHeader(
            title: l10n.demoTerminalHeader,
            trailing: _StatusChip(label: l10n.demoVmService),
          ),
          Expanded(
            child: DecoratedBox(
              decoration: BoxDecoration(color: cs.surfaceContainerLowest),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _TerminalLine(
                    mono: mono,
                    text: r'$ codex',
                    emphasis: true,
                  ),
                  _TerminalLine(
                    mono: mono,
                    text: l10n.demoTerminalLineContext,
                  ),
                  _TerminalLine(
                    mono: mono,
                    text: l10n.demoTerminalLineWidget,
                  ),
                  _TerminalLine(
                    mono: mono,
                    text: l10n.demoTerminalLinePlan,
                  ),
                  _TerminalLine(
                    mono: mono,
                    text: l10n.demoTerminalLineReady,
                    emphasis: true,
                  ),
                ],
              ),
            ),
          ),
          _DemoPromptStrip(l10n: l10n),
        ],
      ),
    );
  }
}

class _DemoInspectorPane extends StatelessWidget {
  const _DemoInspectorPane({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ColoredBox(
      color: cs.surfaceContainerLow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PaneHeader(
            title: l10n.demoInspectorHeader,
            trailing: _StatusChip(label: l10n.demoDeviceName),
          ),
          const Expanded(
            child: WidgetDetailsPanel(selected: DemoWorkspaceView._selection),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Chip(label: Text(l10n.demoContextWidgetChip)),
                const Chip(label: Text('widget-context.md')),
                const Chip(label: Text('initial-prompt.md')),
                FilledButton(
                  onPressed: null,
                  child: Text(l10n.forgeItButton),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DemoPromptStrip extends StatelessWidget {
  const _DemoPromptStrip({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHigh,
        border: Border(top: BorderSide(color: cs.outlineVariant)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.bolt_outlined, color: cs.primary, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                l10n.demoForgePromptReady,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaneHeader extends StatelessWidget {
  const _PaneHeader({required this.title, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title.toUpperCase(),
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class _SelectedTile extends StatelessWidget {
  const _SelectedTile({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: cs.primaryContainer.withValues(alpha: 0.42),
          borderRadius: BorderRadius.circular(8),
        ),
        child: ListTile(
          dense: true,
          leading: Icon(icon, size: 18),
          title: Text(title, overflow: TextOverflow.ellipsis),
          subtitle: Text(subtitle, overflow: TextOverflow.ellipsis),
        ),
      ),
    );
  }
}

class _FileRow extends StatelessWidget {
  const _FileRow({
    required this.depth,
    required this.icon,
    required this.label,
  });

  final int depth;
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(12 + depth * 18, 4, 12, 4),
      child: Row(
        children: [
          Icon(icon, size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(label, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: cs.primary.withValues(alpha: 0.5)),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text(
          label,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.labelSmall,
        ),
      ),
    );
  }
}

class _TerminalLine extends StatelessWidget {
  const _TerminalLine({
    required this.mono,
    required this.text,
    this.emphasis = false,
  });

  final String? mono;
  final String text;
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: mono,
          color: emphasis ? cs.primary : cs.onSurface,
        ),
      ),
    );
  }
}

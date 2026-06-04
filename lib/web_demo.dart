import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

void main() {
  runApp(const PickforgeWebDemoApp());
}

class PickforgeWebDemoApp extends StatelessWidget {
  const PickforgeWebDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pickforge Web Demo',
      debugShowCheckedModeBanner: false,
      theme: PickforgeTheme.dark(),
      darkTheme: PickforgeTheme.dark(),
      themeMode: ThemeMode.dark,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      home: const _WebDemoWorkspace(),
    );
  }
}

class _WebDemoWorkspace extends StatelessWidget {
  const _WebDemoWorkspace();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth < 900) {
              return const SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(height: 300, child: _NavigatorPane()),
                    Divider(height: 1),
                    SizedBox(height: 420, child: _TerminalPane()),
                    Divider(height: 1),
                    SizedBox(height: 680, child: _InspectorPane()),
                  ],
                ),
              );
            }
            return const Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(width: 280, child: _NavigatorPane()),
                VerticalDivider(width: 1),
                Expanded(child: _TerminalPane()),
                VerticalDivider(width: 1),
                SizedBox(width: 360, child: _InspectorPane()),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _NavigatorPane extends StatelessWidget {
  const _NavigatorPane();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _Pane(
      child: ListView(
        children: [
          _PaneHeader(title: l10n.demoWorkspaceTitle),
          _SelectedTile(
            icon: Icons.folder_outlined,
            title: l10n.demoProjectName,
            subtitle: '/demo/sample_flutter_app',
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
    );
  }
}

class _TerminalPane extends StatelessWidget {
  const _TerminalPane();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    return ColoredBox(
      color: colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PaneHeader(
            title: l10n.demoTerminalHeader,
            trailing: _StatusChip(label: l10n.demoVmService),
          ),
          Expanded(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerLowest,
              ),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _TerminalLine(mono: mono, text: r'$ codex', emphasis: true),
                  _TerminalLine(mono: mono, text: l10n.demoTerminalLineContext),
                  _TerminalLine(mono: mono, text: l10n.demoTerminalLineWidget),
                  _TerminalLine(mono: mono, text: l10n.demoTerminalLinePlan),
                  _TerminalLine(
                    mono: mono,
                    text: l10n.demoTerminalLineReady,
                    emphasis: true,
                  ),
                ],
              ),
            ),
          ),
          _PromptStrip(text: l10n.demoForgePromptReady),
        ],
      ),
    );
  }
}

class _InspectorPane extends StatelessWidget {
  const _InspectorPane();

  static const _sourceSnippet = r'''
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
''';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    final mono = Theme.of(context).extension<PickforgeMonoTheme>()?.fontFamily;
    return _Pane(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PaneHeader(
            title: l10n.demoInspectorHeader,
            trailing: _StatusChip(label: l10n.demoDeviceName),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  'CounterPage',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                Text(
                  'lib/main.dart:42:12',
                  style: TextStyle(fontFamily: mono, fontSize: 12),
                ),
                const SizedBox(height: 12),
                Text(
                  l10n.inspectorAncestors,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 6),
                const Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _ChipLabel('MaterialApp'),
                    _ChipLabel('Scaffold'),
                    _ChipLabel('Center'),
                    _ChipLabel('Column'),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  height: 160,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.42),
                    border: Border.all(color: colorScheme.outlineVariant),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'Count: 0',
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 14),
                      const Icon(Icons.add_circle_outline, size: 40),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  l10n.inspectorSource,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 6),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: SelectableText(
                    _sourceSnippet,
                    style: TextStyle(fontFamily: mono, fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _StatusChip(label: l10n.demoContextWidgetChip),
                _StatusChip(label: l10n.demoForgePromptReady),
                _StatusChip(label: l10n.demoVmService),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Pane extends StatelessWidget {
  const _Pane({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: child,
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
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
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
    return ListTile(
      dense: true,
      leading: Icon(icon, size: 18),
      title: Text(title, overflow: TextOverflow.ellipsis),
      subtitle: Text(subtitle, overflow: TextOverflow.ellipsis),
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
      padding: EdgeInsets.only(left: 12.0 + depth * 18, right: 12),
      child: ListTile(
        dense: true,
        leading: Icon(icon, size: 16),
        title: Text(label, overflow: TextOverflow.ellipsis),
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: mono,
          fontSize: 13,
          color: emphasis
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.onSurface,
        ),
      ),
    );
  }
}

class _PromptStrip extends StatelessWidget {
  const _PromptStrip({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        border: Border(top: BorderSide(color: colorScheme.outlineVariant)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(text, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withValues(alpha: 0.42),
        border: Border.all(color: colorScheme.primary.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }
}

class _ChipLabel extends StatelessWidget {
  const _ChipLabel(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.36),
        border: Border.all(color: colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label, overflow: TextOverflow.ellipsis),
    );
  }
}

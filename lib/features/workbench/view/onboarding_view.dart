import 'dart:async';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/settings/onboarding_preferences.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

class OnboardingView extends StatefulWidget {
  const OnboardingView({
    super.key,
    this.pickFolder,
    this.sampleProjectRoot,
    this.diagnosticsService,
    this.openSettings,
    this.dismissOnboarding,
    this.openDemoWorkspace,
  });

  /// Override for tests.
  final Future<String?> Function()? pickFolder;
  final String? sampleProjectRoot;
  final DiagnosticsService? diagnosticsService;
  final VoidCallback? openSettings;
  final Future<void> Function()? dismissOnboarding;
  final VoidCallback? openDemoWorkspace;

  @override
  State<OnboardingView> createState() => _OnboardingViewState();
}

class _OnboardingViewState extends State<OnboardingView> {
  String? _error;
  var _demoMode = false;
  var _setupChecksKey = 0;

  Future<void> _onPick() async {
    final picker = widget.pickFolder ?? getDirectoryPath;
    final picked = await picker();
    if (picked == null) return;
    if (!mounted) return;
    try {
      await context.read<ProjectsCubit>().add(picked);
      if (!mounted) return;
      final s = context.read<ProjectsCubit>().state;
      if (s is ProjectsError) {
        setState(() => _error = s.message);
      }
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Future<void> _openSampleProject() async {
    final root = widget.sampleProjectRoot ??
        p.join(Directory.current.path, 'fixtures', 'sample_flutter_app');
    await _addProject(root);
  }

  Future<void> _addProject(String root) async {
    try {
      await context.read<ProjectsCubit>().add(root);
      if (!mounted) return;
      final s = context.read<ProjectsCubit>().state;
      if (s is ProjectsError) {
        setState(() => _error = s.message);
      }
    } on Object catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Future<void> _dismissOnboarding() async {
    final dismiss = widget.dismissOnboarding;
    if (dismiss != null) {
      await dismiss();
      return;
    }
    await getIt<OnboardingPreferences>().setDismissed(value: true);
    if (!mounted) return;
    context.go(AppRoutes.workbench);
  }

  void _openDemoWorkspace() {
    final openDemo = widget.openDemoWorkspace;
    if (openDemo != null) {
      openDemo();
      return;
    }
    context.go(AppRoutes.demo);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(PickforgeSpacing.xxl),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.folder_open, size: 64),
                const SizedBox(height: PickforgeSpacing.xl),
                Text(
                  l10n.onboardingHeading,
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: PickforgeSpacing.xl),
                FilledButton.icon(
                  onPressed: _onPick,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.workbenchPickFolder),
                ),
                const SizedBox(height: PickforgeSpacing.md),
                OutlinedButton.icon(
                  onPressed: () => setState(() => _demoMode = !_demoMode),
                  icon: const Icon(Icons.smart_toy_outlined),
                  label: Text(l10n.onboardingDemoButton),
                ),
                const SizedBox(height: PickforgeSpacing.md),
                OutlinedButton.icon(
                  onPressed: () => unawaited(_openSampleProject()),
                  icon: const Icon(Icons.folder_special_outlined),
                  label: Text(l10n.onboardingOpenSampleApp),
                ),
                const SizedBox(height: PickforgeSpacing.md),
                OutlinedButton.icon(
                  style: _onboardingCompactButtonStyle(),
                  onPressed: () => unawaited(_dismissOnboarding()),
                  icon: const Icon(Icons.close),
                  label: Text(l10n.onboardingDismissButton),
                ),
                const SizedBox(height: PickforgeSpacing.xl),
                _FirstRunChecklist(l10n: l10n),
                if (_diagnosticsServiceOrNull() case final diagnostics?) ...[
                  const SizedBox(height: PickforgeSpacing.xl),
                  _SetupChecksCard(
                    key: ValueKey(_setupChecksKey),
                    diagnostics: diagnostics,
                    onRetry: () => setState(() => _setupChecksKey++),
                    onOpenSettings: widget.openSettings ??
                        () => context.go(AppRoutes.settings),
                  ),
                ],
                if (_demoMode) ...[
                  const SizedBox(height: PickforgeSpacing.xl),
                  _DemoModeCard(
                    l10n: l10n,
                    onOpenDemo: _openDemoWorkspace,
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: PickforgeSpacing.lg),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  DiagnosticsService? _diagnosticsServiceOrNull() {
    if (widget.diagnosticsService != null) return widget.diagnosticsService;
    try {
      return getIt<DiagnosticsService>();
    } on Object {
      return null;
    }
  }
}

class _OnboardingPanel extends StatelessWidget {
  const _OnboardingPanel({
    required this.child,
    this.background,
    this.borderColor,
  });

  final Widget child;
  final Color? background;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(PickforgeSpacing.lg),
        decoration: BoxDecoration(
          color: background ??
              colorScheme.surfaceContainerHighest.withValues(alpha: 0.28),
          border: Border.all(
            color: borderColor ??
                colorScheme.outlineVariant.withValues(alpha: 0.52),
          ),
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
        ),
        child: child,
      ),
    );
  }
}

class _OnboardingTag extends StatelessWidget {
  const _OnboardingTag(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colorScheme.surface.withValues(alpha: 0.36),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.56),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: PickforgeSpacing.sm,
          vertical: PickforgeSpacing.xs,
        ),
        child: Text(label, style: Theme.of(context).textTheme.labelSmall),
      ),
    );
  }
}

ButtonStyle _onboardingCompactButtonStyle() => OutlinedButton.styleFrom(
      visualDensity: VisualDensity.compact,
      minimumSize: const Size(0, 32),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.sm,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
    );

class _FirstRunChecklist extends StatelessWidget {
  const _FirstRunChecklist({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final items = [
      l10n.onboardingChecklistAddProject,
      l10n.onboardingChecklistPickDevice,
      l10n.onboardingChecklistCreateChat,
      l10n.onboardingChecklistPickWidget,
      l10n.onboardingChecklistForge,
    ];
    return _OnboardingPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.onboardingChecklistTitle,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: PickforgeSpacing.sm),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.symmetric(
                vertical: PickforgeSpacing.xs,
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle_outline, size: 16),
                  const SizedBox(width: PickforgeSpacing.sm),
                  Expanded(child: Text(item)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _SetupChecksCard extends StatelessWidget {
  const _SetupChecksCard({
    required this.diagnostics,
    required this.onRetry,
    required this.onOpenSettings,
    super.key,
  });

  final DiagnosticsService diagnostics;
  final VoidCallback onRetry;
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _OnboardingPanel(
      child: FutureBuilder<DiagnosticsSnapshot>(
        future: diagnostics.snapshot(),
        builder: (context, snapshot) {
          final data = snapshot.data;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.onboardingSetupChecksTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: PickforgeSpacing.sm),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                spacing: PickforgeSpacing.sm,
                children: [
                  OutlinedButton.icon(
                    style: _onboardingCompactButtonStyle(),
                    onPressed: onOpenSettings,
                    icon: const Icon(Icons.settings_outlined, size: 16),
                    label: Text(l10n.onboardingOpenSettings),
                  ),
                  OutlinedButton.icon(
                    style: _onboardingCompactButtonStyle(),
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: Text(l10n.onboardingRetrySetupChecks),
                  ),
                ],
              ),
              const SizedBox(height: PickforgeSpacing.sm),
              if (!snapshot.hasData)
                const LinearProgressIndicator(minHeight: 2)
              else ...[
                _SetupCheckRow(
                  label: l10n.diagnosticsFlutter,
                  available: data!.flutterAvailable,
                  command: 'fvm flutter doctor',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsAdb,
                  available: data.adbAvailable,
                  command: 'adb version',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsEmulator,
                  available: data.emulatorAvailable,
                  command: 'emulator -list-avds',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsClaude,
                  available: data.claudeAvailable,
                  command: 'claude --version',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsCodex,
                  available: data.codexAvailable,
                  command: 'codex --version',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsOpenCode,
                  available: data.openCodeAvailable,
                  command: 'opencode --version',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsCursor,
                  available: data.cursorAvailable,
                  command: 'agent --version',
                ),
                _SetupCheckRow(
                  label: l10n.diagnosticsGemini,
                  available: data.geminiAvailable,
                  command: 'gemini --version',
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SetupCheckRow extends StatelessWidget {
  const _SetupCheckRow({
    required this.label,
    required this.available,
    required this.command,
  });

  final String label;
  final bool available;
  final String command;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PickforgeSpacing.xs),
      child: Row(
        children: [
          Icon(
            available ? Icons.check_circle : Icons.error_outline,
            size: 16,
            color: available ? cs.primary : cs.error,
          ),
          const SizedBox(width: PickforgeSpacing.sm),
          Expanded(child: Text(label)),
          Text(
            available ? l10n.diagnosticsAvailable : l10n.diagnosticsMissing,
            style: TextStyle(color: available ? cs.primary : cs.error),
          ),
          if (!available) ...[
            const SizedBox(width: PickforgeSpacing.xs),
            IconButton(
              tooltip: l10n.onboardingCopySetupCommand,
              icon: const Icon(Icons.copy, size: 16),
              onPressed: () => unawaited(
                Clipboard.setData(ClipboardData(text: command)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DemoModeCard extends StatelessWidget {
  const _DemoModeCard({required this.l10n, required this.onOpenDemo});

  final AppLocalizations l10n;
  final VoidCallback onOpenDemo;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return _OnboardingPanel(
      background: colorScheme.secondaryContainer.withValues(alpha: 0.5),
      borderColor: colorScheme.secondary.withValues(alpha: 0.45),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.preview_outlined),
          const SizedBox(width: PickforgeSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.onboardingDemoTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: PickforgeSpacing.xs),
                Text(l10n.onboardingDemoDescription),
                const SizedBox(height: PickforgeSpacing.md),
                Wrap(
                  spacing: PickforgeSpacing.sm,
                  runSpacing: PickforgeSpacing.sm,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    const _OnboardingTag('sample_flutter_app'),
                    const _OnboardingTag('CounterPage'),
                    const _OnboardingTag('Pixel 10'),
                    const _OnboardingTag('Codex chat'),
                    FilledButton.icon(
                      onPressed: onOpenDemo,
                      icon: const Icon(Icons.open_in_new),
                      label: Text(l10n.onboardingOpenDemoWorkspace),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

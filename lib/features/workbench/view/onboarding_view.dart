import 'dart:async';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class OnboardingView extends StatefulWidget {
  const OnboardingView({
    super.key,
    this.pickFolder,
    this.sampleProjectRoot,
    this.diagnosticsService,
  });

  /// Override for tests.
  final Future<String?> Function()? pickFolder;
  final String? sampleProjectRoot;
  final DiagnosticsService? diagnosticsService;

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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.folder_open, size: 64),
                const SizedBox(height: 24),
                Text(
                  l10n.onboardingHeading,
                  style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _onPick,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.workbenchPickFolder),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => setState(() => _demoMode = !_demoMode),
                  icon: const Icon(Icons.smart_toy_outlined),
                  label: Text(l10n.onboardingDemoButton),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => unawaited(_openSampleProject()),
                  icon: const Icon(Icons.folder_special_outlined),
                  label: Text(l10n.onboardingOpenSampleApp),
                ),
                const SizedBox(height: 24),
                _FirstRunChecklist(l10n: l10n),
                if (_diagnosticsServiceOrNull() case final diagnostics?) ...[
                  const SizedBox(height: 24),
                  _SetupChecksCard(
                    key: ValueKey(_setupChecksKey),
                    diagnostics: diagnostics,
                    onRetry: () => setState(() => _setupChecksKey++),
                  ),
                ],
                if (_demoMode) ...[
                  const SizedBox(height: 24),
                  _DemoModeCard(l10n: l10n),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 16),
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
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.onboardingChecklistTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      const Icon(Icons.check_circle_outline, size: 16),
                      const SizedBox(width: 8),
                      Expanded(child: Text(item)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SetupChecksCard extends StatelessWidget {
  const _SetupChecksCard({
    required this.diagnostics,
    required this.onRetry,
    super.key,
  });

  final DiagnosticsService diagnostics;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FutureBuilder<DiagnosticsSnapshot>(
            future: diagnostics.snapshot(),
            builder: (context, snapshot) {
              final data = snapshot.data;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          l10n.onboardingSetupChecksTitle,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      TextButton.icon(
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh, size: 16),
                        label: Text(l10n.onboardingRetrySetupChecks),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (!snapshot.hasData)
                    const LinearProgressIndicator(minHeight: 1)
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
                  ],
                ],
              );
            },
          ),
        ),
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
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(
            available ? Icons.check_circle : Icons.error_outline,
            size: 16,
            color: available ? cs.primary : cs.error,
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(label)),
          Text(
            available ? l10n.diagnosticsAvailable : l10n.diagnosticsMissing,
            style: TextStyle(color: available ? cs.primary : cs.error),
          ),
          if (!available) ...[
            const SizedBox(width: 4),
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
  const _DemoModeCard({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Card(
        color: Theme.of(context).colorScheme.secondaryContainer,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.preview_outlined),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.onboardingDemoTitle,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(l10n.onboardingDemoDescription),
                    const SizedBox(height: 12),
                    const Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        Chip(label: Text('sample_flutter_app')),
                        Chip(label: Text('CounterPage')),
                        Chip(label: Text('Pixel 10')),
                        Chip(label: Text('Codex chat')),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

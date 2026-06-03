import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/device_run_settings.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({
    super.key,
    this.settingsCubit,
    this.deviceRunSettingsCubit,
    this.diagnosticsService,
  });

  final SettingsCubit? settingsCubit;
  final DeviceRunSettingsCubit? deviceRunSettingsCubit;
  final DiagnosticsService? diagnosticsService;

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final SettingsCubit _cubit;
  late final DeviceRunSettingsCubit _deviceRunCubit;
  late final bool _ownsSettingsCubit;
  late final bool _ownsDeviceRunCubit;
  String? _projectRoot;

  @override
  void initState() {
    super.initState();
    _ownsSettingsCubit = widget.settingsCubit == null;
    _ownsDeviceRunCubit = widget.deviceRunSettingsCubit == null;
    _cubit = widget.settingsCubit ?? getIt<SettingsCubit>();
    _deviceRunCubit = widget.deviceRunSettingsCubit ??
        DeviceRunSettingsCubit(
          settings: getIt<ProjectSettingsRepository>(),
          discovery: getIt<DeviceDiscoveryService>(),
        );
  }

  @override
  void dispose() {
    if (_ownsSettingsCubit) _cubit.close().ignore();
    if (_ownsDeviceRunCubit) _deviceRunCubit.close().ignore();
    super.dispose();
  }

  void _loadProject(String projectRoot) {
    if (_projectRoot == projectRoot) return;
    _projectRoot = projectRoot;
    unawaited(
      _cubit
          .load(projectRoot)
          .catchError((Object error, StackTrace stackTrace) {
        _handleLoadError(projectRoot, error, stackTrace);
      }),
    );
    unawaited(
      _deviceRunCubit
          .load(projectRoot)
          .catchError((Object error, StackTrace stackTrace) {
        _handleLoadError(projectRoot, error, stackTrace);
      }),
    );
  }

  void _handleLoadError(
    String projectRoot,
    Object error,
    StackTrace stackTrace,
  ) {
    if (!mounted || _projectRoot != projectRoot) return;
    Zone.current.handleUncaughtError(error, stackTrace);
  }

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider.value(value: _cubit),
        BlocProvider.value(value: _deviceRunCubit),
      ],
      child: BlocBuilder<ProjectsCubit, ProjectsState>(
        builder: (context, projectsState) {
          final projectRoot = switch (projectsState) {
            ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
            _ => null,
          };
          if (projectRoot == null) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Select a project to configure project settings.'),
            );
          }
          _loadProject(projectRoot);
          return BlocBuilder<SettingsCubit, SettingsState>(
            builder: (context, state) {
              return SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildAgentDropdown(state, context, projectRoot),
                    const SizedBox(height: 24),
                    DeviceRunSettings(
                      key: ValueKey(projectRoot),
                      projectRoot: projectRoot,
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Embedded Terminal',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    _buildFontFamilyDropdown(state, context),
                    const SizedBox(height: 12),
                    _buildFontSizeSlider(state, context),
                    const SizedBox(height: 12),
                    _buildThemeDropdown(state, context),
                    if (_diagnosticsServiceOrNull()
                        case final diagnostics?) ...[
                      const SizedBox(height: 24),
                      _DiagnosticsSection(
                        diagnostics: diagnostics,
                        projectRoot: projectRoot,
                      ),
                    ],
                  ],
                ),
              );
            },
          );
        },
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

  Widget _buildAgentDropdown(
    SettingsState state,
    BuildContext context,
    String projectRoot,
  ) {
    return Row(
      children: [
        const Text('Default agent: '),
        DropdownButton<AgentProfileId>(
          value: state.defaultAgent != null
              ? AgentProfileId.fromValue(state.defaultAgent!)
              : null,
          items: AgentProfileId.values
              .map(
                (id) => DropdownMenuItem(value: id, child: Text(id.value)),
              )
              .toList(),
          onChanged: (id) {
            if (id != null) {
              context
                  .read<SettingsCubit>()
                  .setDefaultAgent(projectRoot, id.value)
                  .ignore();
            }
          },
        ),
      ],
    );
  }

  Widget _buildFontFamilyDropdown(SettingsState state, BuildContext context) {
    const families = [
      'monospace',
      'JetBrains Mono',
      'Berkeley Mono',
    ];
    return Row(
      children: [
        const Text('Font family: '),
        DropdownButton<String>(
          value: families.contains(state.terminal.fontFamily)
              ? state.terminal.fontFamily
              : 'monospace',
          items: families
              .map((f) => DropdownMenuItem(value: f, child: Text(f)))
              .toList(),
          onChanged: (f) {
            if (f != null) {
              context
                  .read<SettingsCubit>()
                  .setTerminal(
                    EmbeddedTerminalSettings(
                      fontFamily: f,
                      fontSize: state.terminal.fontSize,
                      themeId: state.terminal.themeId,
                    ),
                  )
                  .ignore();
            }
          },
        ),
      ],
    );
  }

  Widget _buildFontSizeSlider(SettingsState state, BuildContext context) {
    return Row(
      children: [
        const Text('Font size: '),
        Expanded(
          child: Slider(
            value: state.terminal.fontSize,
            min: 10,
            max: 18,
            divisions: 8,
            label: state.terminal.fontSize.toStringAsFixed(0),
            onChanged: (v) {
              context
                  .read<SettingsCubit>()
                  .setTerminal(
                    EmbeddedTerminalSettings(
                      fontFamily: state.terminal.fontFamily,
                      fontSize: v,
                      themeId: state.terminal.themeId,
                    ),
                  )
                  .ignore();
            },
          ),
        ),
        Text(state.terminal.fontSize.toStringAsFixed(0)),
      ],
    );
  }

  Widget _buildThemeDropdown(SettingsState state, BuildContext context) {
    return Row(
      children: [
        const Text('Theme: '),
        DropdownButton<TerminalThemeId>(
          value: state.terminal.themeId,
          items: TerminalThemeId.values
              .map(
                (t) => DropdownMenuItem(value: t, child: Text(t.name)),
              )
              .toList(),
          onChanged: (t) {
            if (t != null) {
              context
                  .read<SettingsCubit>()
                  .setTerminal(
                    EmbeddedTerminalSettings(
                      fontFamily: state.terminal.fontFamily,
                      fontSize: state.terminal.fontSize,
                      themeId: t,
                    ),
                  )
                  .ignore();
            }
          },
        ),
      ],
    );
  }
}

class _DiagnosticsSection extends StatelessWidget {
  const _DiagnosticsSection({
    required this.diagnostics,
    required this.projectRoot,
  });

  final DiagnosticsService diagnostics;
  final String? projectRoot;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder<DiagnosticsSnapshot>(
      future: diagnostics.snapshot(),
      builder: (context, snapshot) {
        final data = snapshot.data;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.diagnosticsTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                if (!snapshot.hasData)
                  const LinearProgressIndicator(minHeight: 1)
                else ...[
                  _DiagnosticRow(
                    label: l10n.diagnosticsOperatingSystem,
                    value: data!.operatingSystem,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsAdb,
                    value: data.adbAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsGit,
                    value: data.gitAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsFlutter,
                    value: data.flutterAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsEmulator,
                    value: data.emulatorAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsClaude,
                    value: data.claudeAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsCodex,
                    value: data.codexAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  _DiagnosticRow(
                    label: l10n.diagnosticsOpenCode,
                    value: data.openCodeAvailable
                        ? l10n.diagnosticsAvailable
                        : l10n.diagnosticsMissing,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => unawaited(
                      _copySupportBundle(context, diagnostics, projectRoot),
                    ),
                    icon: const Icon(Icons.ios_share, size: 16),
                    label: Text(l10n.diagnosticsCopySupportBundle),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

Future<void> _copySupportBundle(
  BuildContext context,
  DiagnosticsService diagnostics,
  String? projectRoot,
) async {
  final l10n = AppLocalizations.of(context);
  final bundle = await diagnostics.buildSupportBundle(
    activeProjectRoot: projectRoot,
  );
  if (!context.mounted) return;
  await Clipboard.setData(ClipboardData(text: bundle));
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(l10n.diagnosticsSupportBundleCopied)),
  );
}

class _DiagnosticRow extends StatelessWidget {
  const _DiagnosticRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelMedium,
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

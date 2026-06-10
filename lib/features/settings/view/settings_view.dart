import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/device_run_settings.dart';
import 'package:pickforge/features/settings/widgets/settings_section.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({
    super.key,
    this.settingsCubit,
    this.deviceRunSettingsCubit,
    this.diagnosticsService,
    this.updateSettingsRepository,
    this.telemetrySettingsRepository,
  });

  final SettingsCubit? settingsCubit;
  final DeviceRunSettingsCubit? deviceRunSettingsCubit;
  final DiagnosticsService? diagnosticsService;
  final UpdateCheckSettingsRepository? updateSettingsRepository;
  final TelemetrySettingsRepository? telemetrySettingsRepository;

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
    final l10n = AppLocalizations.of(context);
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
            return Padding(
              padding: const EdgeInsets.all(PickforgeSpacing.lg),
              child: SettingsEmptyState(
                icon: Icons.tune,
                message: l10n.settingsNoProject,
              ),
            );
          }
          _loadProject(projectRoot);
          return BlocBuilder<SettingsCubit, SettingsState>(
            builder: (context, state) {
              return SingleChildScrollView(
                padding: const EdgeInsets.all(PickforgeSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SettingsSection(
                      title: l10n.settingsDefaultAgent,
                      children: [
                        _buildAgentDropdown(state, context, projectRoot),
                      ],
                    ),
                    const SizedBox(height: PickforgeSpacing.lg),
                    const _AgentModelsSection(),
                    const SizedBox(height: PickforgeSpacing.lg),
                    SettingsSection(
                      title: l10n.settingsProjectValidator,
                      children: [
                        _ValidatorCommandField(
                          projectRoot: projectRoot,
                          command: state.validatorCommand,
                        ),
                      ],
                    ),
                    const SizedBox(height: PickforgeSpacing.lg),
                    DeviceRunSettings(
                      key: ValueKey(projectRoot),
                      projectRoot: projectRoot,
                    ),
                    const SizedBox(height: PickforgeSpacing.lg),
                    SettingsSection(
                      title: l10n.settingsEmbeddedTerminal,
                      children: [
                        _buildFontFamilyDropdown(state, context),
                        _buildFontSizeSlider(state, context),
                        _buildThemeDropdown(state, context),
                      ],
                    ),
                    if (_updateSettingsRepositoryOrNull()
                        case final updateSettings?) ...[
                      const SizedBox(height: PickforgeSpacing.lg),
                      _UpdateSettingsSection(repository: updateSettings),
                    ],
                    if (_telemetrySettingsRepositoryOrNull()
                        case final telemetrySettings?) ...[
                      const SizedBox(height: PickforgeSpacing.lg),
                      _TelemetrySettingsSection(
                        repository: telemetrySettings,
                      ),
                    ],
                    if (_diagnosticsServiceOrNull()
                        case final diagnostics?) ...[
                      const SizedBox(height: PickforgeSpacing.lg),
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

  UpdateCheckSettingsRepository? _updateSettingsRepositoryOrNull() {
    if (widget.updateSettingsRepository != null) {
      return widget.updateSettingsRepository;
    }
    try {
      return getIt<UpdateCheckSettingsRepository>();
    } on Object {
      return null;
    }
  }

  TelemetrySettingsRepository? _telemetrySettingsRepositoryOrNull() {
    if (widget.telemetrySettingsRepository != null) {
      return widget.telemetrySettingsRepository;
    }
    try {
      return getIt<TelemetrySettingsRepository>();
    } on Object {
      return null;
    }
  }

  Widget _buildAgentDropdown(
    SettingsState state,
    BuildContext context,
    String projectRoot,
  ) {
    return DropdownButtonFormField<AgentProfileId>(
      initialValue: state.defaultAgent != null
          ? AgentProfileId.fromValue(state.defaultAgent!)
          : null,
      decoration: settingsInputDecoration().copyWith(
        helperText: AppLocalizations.of(context).settingsDefaultAgentHelper,
      ),
      isExpanded: true,
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
    );
  }

  Widget _buildFontFamilyDropdown(SettingsState state, BuildContext context) {
    const families = [
      'GeistMono',
      'JetBrains Mono',
      'JetBrainsMono Nerd Font',
      'Berkeley Mono',
      'monospace',
    ];
    return SettingsField(
      label: AppLocalizations.of(context).settingsFontFamily,
      child: DropdownButtonFormField<String>(
        initialValue: families.contains(state.terminal.fontFamily)
            ? state.terminal.fontFamily
            : 'monospace',
        decoration: settingsInputDecoration(),
        isExpanded: true,
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
    );
  }

  Widget _buildFontSizeSlider(SettingsState state, BuildContext context) {
    return SettingsField(
      label: AppLocalizations.of(context).settingsFontSize,
      child: Row(
        children: [
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
          const SizedBox(width: PickforgeSpacing.sm),
          SizedBox(
            width: 28,
            child: Text(
              state.terminal.fontSize.toStringAsFixed(0),
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildThemeDropdown(SettingsState state, BuildContext context) {
    return SettingsField(
      label: AppLocalizations.of(context).settingsTheme,
      child: DropdownButtonFormField<TerminalThemeId>(
        initialValue: state.terminal.themeId,
        decoration: settingsInputDecoration(),
        isExpanded: true,
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
    );
  }
}

class _AgentModelsSection extends StatefulWidget {
  const _AgentModelsSection();

  @override
  State<_AgentModelsSection> createState() => _AgentModelsSectionState();
}

class _AgentModelsSectionState extends State<_AgentModelsSection> {
  AgentModelSettingsRepository? _repo;
  late AgentModelSettings _settings;

  @override
  void initState() {
    super.initState();
    if (getIt.isRegistered<AgentModelSettingsRepository>()) {
      _repo = getIt<AgentModelSettingsRepository>();
      _settings = _repo!.load();
    } else {
      _settings = AgentModelSettings.defaults;
    }
  }

  void _set(AgentProfileId id, String slug) {
    _repo?.setModel(id, slug).ignore();
    setState(() {
      _settings = AgentModelSettings({..._settings.models, id: slug});
    });
  }

  String _resolved(AgentProfileId id, List<AgentModelOption> options) {
    final current = _settings.modelFor(id);
    if (current != null && options.any((o) => o.slug == current)) {
      return current;
    }
    return options.first.slug;
  }

  String _agentLabel(AgentProfileId id) => switch (id) {
        AgentProfileId.claudeCode => 'Claude Code',
        AgentProfileId.codex => 'Codex',
        AgentProfileId.opencode => 'OpenCode',
        AgentProfileId.cursor => 'Cursor',
        AgentProfileId.gemini => 'Gemini',
      };

  @override
  Widget build(BuildContext context) {
    return SettingsSection(
      title: AppLocalizations.of(context).settingsAgentModels,
      children: [
        Text(
          AppLocalizations.of(context).settingsAgentModelsHelper,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        for (final entry in AgentModelSettings.presets.entries)
          SettingsField(
            label: _agentLabel(entry.key),
            child: DropdownButtonFormField<String>(
              initialValue: _resolved(entry.key, entry.value),
              decoration: settingsInputDecoration(),
              isExpanded: true,
              items: entry.value
                  .map(
                    (o) => DropdownMenuItem(
                      value: o.slug,
                      child: Text(o.label),
                    ),
                  )
                  .toList(),
              onChanged: (slug) {
                if (slug != null) _set(entry.key, slug);
              },
            ),
          ),
      ],
    );
  }
}

class _ValidatorCommandField extends StatefulWidget {
  const _ValidatorCommandField({
    required this.projectRoot,
    required this.command,
  });

  final String projectRoot;
  final String? command;

  @override
  State<_ValidatorCommandField> createState() => _ValidatorCommandFieldState();
}

class _ValidatorCommandFieldState extends State<_ValidatorCommandField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.command ?? '');
  }

  @override
  void didUpdateWidget(_ValidatorCommandField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.command != widget.command &&
        _controller.text != (widget.command ?? '')) {
      _controller.text = widget.command ?? '';
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SettingsField(
      label: l10n.settingsValidatorCommand,
      alignment: CrossAxisAlignment.start,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              decoration: settingsInputDecoration(
                helperText: l10n.settingsValidatorCommandHelper,
              ),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _save(context),
            ),
          ),
          const SizedBox(width: PickforgeSpacing.sm),
          OutlinedButton.icon(
            style: settingsCompactButtonStyle(),
            onPressed: () => _save(context),
            icon: const Icon(Icons.save_outlined, size: 16),
            label: Text(l10n.settingsValidatorCommandSave),
          ),
        ],
      ),
    );
  }

  void _save(BuildContext context) {
    context
        .read<SettingsCubit>()
        .setValidatorCommand(
          widget.projectRoot,
          _controller.text,
        )
        .ignore();
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
        return SettingsSection(
          title: l10n.diagnosticsTitle,
          children: [
            if (!snapshot.hasData)
              const LinearProgressIndicator(minHeight: 2)
            else ...[
              _DiagnosticRow(
                label: l10n.diagnosticsAppVersion,
                value: data!.appVersion,
              ),
              ..._buildMetadataRows(l10n, data.buildMetadata),
              _DiagnosticRow(
                label: l10n.diagnosticsOperatingSystem,
                value: data.operatingSystem,
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
                value: data.flutterVersion ?? l10n.diagnosticsMissing,
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
              _DiagnosticRow(
                label: l10n.diagnosticsCursor,
                value: data.cursorAvailable
                    ? l10n.diagnosticsAvailable
                    : l10n.diagnosticsMissing,
              ),
              _DiagnosticRow(
                label: l10n.diagnosticsGemini,
                value: data.geminiAvailable
                    ? l10n.diagnosticsAvailable
                    : l10n.diagnosticsMissing,
              ),
              _DiagnosticRow(
                label: l10n.diagnosticsLastVmError,
                value: data.lastVmError ?? l10n.diagnosticsNoVmError,
              ),
              if (data.failures.isNotEmpty) ...[
                const SizedBox(height: PickforgeSpacing.sm),
                Text(
                  l10n.diagnosticsRecentFailures,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: PickforgeSpacing.xs),
                for (final failure in data.failures)
                  _DiagnosticFailureRow(
                    label: _failureLabel(l10n, failure.kind),
                    failure: failure,
                  ),
              ],
              if (data.performanceCounters.isNotEmpty) ...[
                const SizedBox(height: PickforgeSpacing.sm),
                Text(
                  l10n.diagnosticsPerformanceCounters,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: PickforgeSpacing.xs),
                for (final counter in data.performanceCounters)
                  _DiagnosticRow(
                    label: counter.name,
                    value: _performanceCounterValue(counter),
                  ),
              ],
              const SizedBox(height: PickforgeSpacing.xs),
              OutlinedButton.icon(
                style: settingsCompactButtonStyle(),
                onPressed: () => unawaited(
                  _copySupportBundle(context, diagnostics, projectRoot),
                ),
                icon: const Icon(Icons.ios_share, size: 16),
                label: Text(l10n.diagnosticsCopySupportBundle),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _UpdateSettingsSection extends StatefulWidget {
  const _UpdateSettingsSection({required this.repository});

  final UpdateCheckSettingsRepository repository;

  @override
  State<_UpdateSettingsSection> createState() => _UpdateSettingsSectionState();
}

class _UpdateSettingsSectionState extends State<_UpdateSettingsSection> {
  late Future<UpdateCheckSettings> _settings;

  @override
  void initState() {
    super.initState();
    _settings = widget.repository.load();
  }

  Future<void> _setEnabled(bool enabled) async {
    await widget.repository.setEnabled(enabled: enabled);
    if (!mounted) return;
    setState(() {
      _settings = widget.repository.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder<UpdateCheckSettings>(
      future: _settings,
      builder: (context, snapshot) {
        final settings = snapshot.data;
        return SettingsSection(
          title: l10n.settingsUpdates,
          children: [
            if (settings == null)
              const LinearProgressIndicator(minHeight: 2)
            else
              SettingsToggleRow(
                switchKey: const Key('update-check-enabled'),
                label: l10n.settingsUpdateCheckEnabled,
                value: settings.enabled,
                onChanged: (value) => _setEnabled(value).ignore(),
              ),
          ],
        );
      },
    );
  }
}

class _TelemetrySettingsSection extends StatefulWidget {
  const _TelemetrySettingsSection({required this.repository});

  final TelemetrySettingsRepository repository;

  @override
  State<_TelemetrySettingsSection> createState() =>
      _TelemetrySettingsSectionState();
}

class _TelemetrySettingsSectionState extends State<_TelemetrySettingsSection> {
  late Future<TelemetrySettings> _settings;

  @override
  void initState() {
    super.initState();
    _settings = widget.repository.load();
  }

  Future<void> _setEnabled(bool enabled) async {
    await widget.repository.setEnabled(enabled: enabled);
    if (!mounted) return;
    setState(() {
      _settings = widget.repository.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder<TelemetrySettings>(
      future: _settings,
      builder: (context, snapshot) {
        final settings = snapshot.data;
        return SettingsSection(
          title: l10n.settingsPrivacy,
          children: [
            if (settings == null)
              const LinearProgressIndicator(minHeight: 2)
            else
              SettingsToggleRow(
                switchKey: const Key('telemetry-enabled'),
                label: l10n.settingsTelemetryEnabled,
                value: settings.enabled,
                onChanged: (value) => _setEnabled(value).ignore(),
              ),
          ],
        );
      },
    );
  }
}

String _failureLabel(AppLocalizations l10n, DiagnosticsFailureKind kind) =>
    switch (kind) {
      DiagnosticsFailureKind.connection => l10n.diagnosticsFailureConnection,
      DiagnosticsFailureKind.run => l10n.diagnosticsFailureRun,
      DiagnosticsFailureKind.agent => l10n.diagnosticsFailureAgent,
    };

List<Widget> _buildMetadataRows(
  AppLocalizations l10n,
  DiagnosticsBuildMetadata metadata,
) =>
    [
      if (metadata.commitSha case final value?)
        _DiagnosticRow(label: l10n.diagnosticsBuildCommit, value: value),
      if (metadata.refName case final value?)
        _DiagnosticRow(label: l10n.diagnosticsBuildRef, value: value),
      if (metadata.workflow case final value?)
        _DiagnosticRow(label: l10n.diagnosticsBuildWorkflow, value: value),
      if (metadata.runLabel case final value?)
        _DiagnosticRow(label: l10n.diagnosticsBuildRun, value: value),
      if (metadata.buildUrl case final value?)
        _DiagnosticRow(label: l10n.diagnosticsBuildUrl, value: value),
    ];

String _performanceCounterValue(DiagnosticsPerformanceCounter counter) {
  final sampleLabel = _sampleLabel(counter.sampleCount);
  return 'last ${counter.lastDuration.inMilliseconds}ms, '
      'max ${counter.maxDuration.inMilliseconds}ms, $sampleLabel';
}

String _sampleLabel(int count) => count == 1 ? '1 sample' : '$count samples';

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

Future<void> _copyErrorDetails(
  BuildContext context,
  DiagnosticsFailureDetails failure,
) async {
  final l10n = AppLocalizations.of(context);
  await Clipboard.setData(ClipboardData(text: failure.clipboardText));
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(l10n.diagnosticsErrorDetailsCopied)),
  );
}

class _DiagnosticFailureRow extends StatelessWidget {
  const _DiagnosticFailureRow({
    required this.label,
    required this.failure,
  });

  final String label;
  final DiagnosticsFailureDetails failure;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PickforgeSpacing.xs),
      child: Row(
        children: [
          SizedBox(
            width: 136,
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelMedium,
            ),
          ),
          const SizedBox(width: PickforgeSpacing.md),
          Expanded(child: Text(failure.message)),
          IconButton(
            tooltip: l10n.diagnosticsCopyErrorDetails,
            onPressed: () => unawaited(_copyErrorDetails(context, failure)),
            icon: const Icon(Icons.copy, size: 16),
          ),
        ],
      ),
    );
  }
}

class _DiagnosticRow extends StatelessWidget {
  const _DiagnosticRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PickforgeSpacing.xs),
      child: Row(
        children: [
          SizedBox(
            width: 136,
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelMedium,
            ),
          ),
          const SizedBox(width: PickforgeSpacing.md),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

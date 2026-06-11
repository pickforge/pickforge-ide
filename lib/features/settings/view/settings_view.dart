import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/appearance/appearance_settings.dart';
import 'package:pickforge/core/chats/chat_metadata.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/diagnostics/diagnostics_service.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/logging/app_logging.dart';
import 'package:pickforge/core/logging/log_settings.dart';
import 'package:pickforge/core/notifications/notification_settings.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/device_run_settings.dart';
import 'package:pickforge/features/settings/widgets/settings_section.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/chats_state.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({
    super.key,
    this.settingsCubit,
    this.deviceRunSettingsCubit,
    this.diagnosticsService,
    this.updateSettingsRepository,
    this.telemetrySettingsRepository,
    this.notificationSettingsRepository,
    this.appearanceController,
  });

  final SettingsCubit? settingsCubit;
  final DeviceRunSettingsCubit? deviceRunSettingsCubit;
  final DiagnosticsService? diagnosticsService;
  final UpdateCheckSettingsRepository? updateSettingsRepository;
  final TelemetrySettingsRepository? telemetrySettingsRepository;
  final NotificationSettingsRepository? notificationSettingsRepository;
  final AppearanceController? appearanceController;

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
    // The settings route renders this view bare: the Scaffold is what gives
    // the page its Material surface and default text style (without it every
    // unstyled Text falls back to the red/yellow error style).
    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SettingsHeader(title: l10n.settingsTitle),
          Divider(
            height: 1,
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
          Expanded(child: _buildBody(l10n)),
        ],
      ),
    );
  }

  Widget _buildBody(AppLocalizations l10n) {
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
                padding: const EdgeInsets.symmetric(
                  horizontal: PickforgeSpacing.xl,
                  vertical: PickforgeSpacing.xl,
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 720),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_appearanceControllerOrNull()
                            case final appearance?) ...[
                          _AppearanceSection(controller: appearance),
                          const SizedBox(height: PickforgeSpacing.lg),
                        ],
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
                        if (_notificationSettingsRepositoryOrNull()
                            case final notificationSettings?) ...[
                          const SizedBox(height: PickforgeSpacing.lg),
                          _NotificationSettingsSection(
                            repository: notificationSettings,
                          ),
                        ],
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
                        if (getIt.isRegistered<AppLogging>() &&
                            getIt.isRegistered<LogSettingsRepository>()) ...[
                          const SizedBox(height: PickforgeSpacing.lg),
                          _LogsSection(
                            logging: getIt<AppLogging>(),
                            settings: getIt<LogSettingsRepository>(),
                          ),
                        ],
                        const SizedBox(height: PickforgeSpacing.lg),
                        const _ArchivedSection(),
                      ],
                    ),
                  ),
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

  AppearanceController? _appearanceControllerOrNull() {
    if (widget.appearanceController != null) return widget.appearanceController;
    try {
      return getIt<AppearanceController>();
    } on Object {
      return null;
    }
  }

  NotificationSettingsRepository? _notificationSettingsRepositoryOrNull() {
    if (widget.notificationSettingsRepository != null) {
      return widget.notificationSettingsRepository;
    }
    try {
      return getIt<NotificationSettingsRepository>();
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

class _NotificationSettingsSection extends StatefulWidget {
  const _NotificationSettingsSection({required this.repository});

  final NotificationSettingsRepository repository;

  @override
  State<_NotificationSettingsSection> createState() =>
      _NotificationSettingsSectionState();
}

/// Theme mode + workbench backdrop. Live-applies through the app-wide
/// [AppearanceController]; persistence is handled inside the controller.
class _AppearanceSection extends StatelessWidget {
  const _AppearanceSection({required this.controller});

  final AppearanceController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ValueListenableBuilder<AppearanceSettings>(
      valueListenable: controller,
      builder: (context, settings, _) {
        return SettingsSection(
          title: l10n.settingsAppearance,
          children: [
            SettingsField(
              label: l10n.settingsThemeMode,
              child: SegmentedButton<AppearanceThemeMode>(
                key: const Key('appearance-theme-mode'),
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(
                    value: AppearanceThemeMode.system,
                    label: Text(l10n.settingsThemeModeSystem),
                  ),
                  ButtonSegment(
                    value: AppearanceThemeMode.dark,
                    label: Text(l10n.settingsThemeModeDark),
                  ),
                  ButtonSegment(
                    value: AppearanceThemeMode.light,
                    label: Text(l10n.settingsThemeModeLight),
                  ),
                ],
                selected: {settings.themeMode},
                onSelectionChanged: (selection) => controller
                    .update(settings.copyWith(themeMode: selection.single))
                    .ignore(),
              ),
            ),
            SettingsToggleRow(
              switchKey: const Key('appearance-forge-backdrop'),
              label: l10n.settingsForgeBackdrop,
              value: settings.backdrop == WorkbenchBackdrop.forge,
              onChanged: (value) => controller
                  .update(
                    settings.copyWith(
                      backdrop: value
                          ? WorkbenchBackdrop.forge
                          : WorkbenchBackdrop.plain,
                    ),
                  )
                  .ignore(),
            ),
            Text(
              l10n.settingsForgeBackdropHelper,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (settings.backdrop == WorkbenchBackdrop.forge) ...[
              SettingsToggleRow(
                switchKey: const Key('appearance-animated-embers'),
                label: l10n.settingsAnimatedEmbers,
                value: settings.animatedBackdrop,
                onChanged: (value) => controller
                    .update(settings.copyWith(animatedBackdrop: value))
                    .ignore(),
              ),
              Text(
                l10n.settingsAnimatedEmbersHelper,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ],
        );
      },
    );
  }
}

class _NotificationSettingsSectionState
    extends State<_NotificationSettingsSection> {
  late Future<NotificationSettings> _settings;

  @override
  void initState() {
    super.initState();
    _settings = widget.repository.load();
  }

  Future<void> _setChatReadySound(bool enabled) async {
    await widget.repository.setChatReadySoundEnabled(enabled: enabled);
    if (!mounted) return;
    setState(() {
      _settings = widget.repository.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder<NotificationSettings>(
      future: _settings,
      builder: (context, snapshot) {
        final settings = snapshot.data;
        return SettingsSection(
          title: l10n.settingsNotifications,
          children: [
            if (settings == null)
              const LinearProgressIndicator(minHeight: 2)
            else ...[
              SettingsToggleRow(
                switchKey: const Key('chat-ready-sound-enabled'),
                label: l10n.settingsChatReadySound,
                value: settings.chatReadySoundEnabled,
                onChanged: (value) => _setChatReadySound(value).ignore(),
              ),
              Text(
                l10n.settingsChatReadySoundHelper,
                style: Theme.of(context).textTheme.bodySmall,
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
    runLogTail: getIt.isRegistered<AppLogging>()
        ? await getIt<AppLogging>().tail()
        : null,
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
          Expanded(
            child: Text(
              value,
              style: PickforgeText.mono.copyWith(
                fontSize: 12,
                color: PickforgeColors.textMed,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Archived chats and projects live only here: restore them to the
/// workspace or delete them permanently.
class _ArchivedSection extends StatelessWidget {
  const _ArchivedSection();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // Settings can be embedded without the workspace chats cubit (isolated
    // harnesses); archived management needs it to do anything useful.
    final ChatsCubit chatsCubit;
    try {
      chatsCubit = context.read<ChatsCubit>();
    } on Object {
      return const SizedBox.shrink();
    }
    return BlocBuilder<ProjectsCubit, ProjectsState>(
      builder: (context, projectsState) {
        final archivedProjects = switch (projectsState) {
          ProjectsReady(:final archivedProjects) => archivedProjects,
          _ => const <ProjectRow>[],
        };
        return BlocBuilder<ChatsCubit, ChatsState>(
          bloc: chatsCubit,
          builder: (context, chatsState) {
            final archivedChats = <ChatRow>[
              if (chatsState case ChatsReady(:final chatsByProject))
                for (final chats in chatsByProject.values)
                  for (final chat in chats)
                    if (chat.taskStatus == ChatTaskStatus.archived) chat,
            ];
            return SettingsSection(
              title: l10n.settingsArchivedTitle,
              children: [
                if (archivedProjects.isEmpty && archivedChats.isEmpty)
                  Text(
                    l10n.settingsArchivedEmpty,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: PickforgeColors.textMed,
                        ),
                  ),
                if (archivedProjects.isNotEmpty) ...[
                  Text(
                    l10n.settingsArchivedProjects,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: PickforgeColors.textMed,
                        ),
                  ),
                  for (final project in archivedProjects)
                    _ArchivedRow(
                      icon: Icons.folder_outlined,
                      title: project.displayName,
                      subtitle: project.projectRoot,
                      onRestore: () => unawaited(
                        context
                            .read<ProjectsCubit>()
                            .restoreProject(project.projectRoot),
                      ),
                      onDelete: () => unawaited(
                        _deleteProjectForever(context, project),
                      ),
                    ),
                ],
                if (archivedChats.isNotEmpty) ...[
                  if (archivedProjects.isNotEmpty)
                    const SizedBox(height: PickforgeSpacing.sm),
                  Text(
                    l10n.settingsArchivedChats,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: PickforgeColors.textMed,
                        ),
                  ),
                  for (final chat in archivedChats)
                    _ArchivedRow(
                      icon: Icons.chat_bubble_outline,
                      title: chat.title,
                      subtitle: chat.projectRoot,
                      onRestore: () => unawaited(
                        context.read<ChatsCubit>().setTaskStatus(
                              chat.chatId,
                              ChatTaskStatus.active,
                            ),
                      ),
                      onDelete: () => unawaited(
                        _deleteChatForever(context, chat),
                      ),
                    ),
                ],
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _deleteProjectForever(
    BuildContext context,
    ProjectRow project,
  ) async {
    final l10n = AppLocalizations.of(context);
    final cubit = context.read<ProjectsCubit>();
    final confirmed = await _confirmForever(
      context,
      title: l10n.projectDeleteConfirmTitle,
      message: l10n.projectDeleteConfirmMessage(project.displayName),
      confirmLabel: l10n.projectDeleteConfirm,
    );
    if (confirmed ?? false) await cubit.remove(project.projectRoot);
  }

  Future<void> _deleteChatForever(BuildContext context, ChatRow chat) async {
    final l10n = AppLocalizations.of(context);
    final cubit = context.read<ChatsCubit>();
    final confirmed = await _confirmForever(
      context,
      title: l10n.chatDeleteConfirmTitle,
      message: l10n.chatDeleteConfirmMessage(chat.title),
      confirmLabel: l10n.chatDeleteConfirm,
    );
    if (confirmed ?? false) await cubit.remove(chat.chatId);
  }

  Future<bool?> _confirmForever(
    BuildContext context, {
    required String title,
    required String message,
    required String confirmLabel,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(MaterialLocalizations.of(ctx).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
  }
}

class _ArchivedRow extends StatelessWidget {
  const _ArchivedRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onRestore,
    required this.onDelete,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onRestore;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: PickforgeSpacing.xs),
      child: Row(
        children: [
          Icon(icon, size: 16, color: PickforgeColors.textMed),
          const SizedBox(width: PickforgeSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: PickforgeColors.textHi,
                  ),
                ),
                Text(
                  subtitle,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: PickforgeColors.textLow,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: PickforgeSpacing.sm),
          TextButton(
            onPressed: onRestore,
            child: Text(l10n.settingsRestore),
          ),
          TextButton(
            onPressed: onDelete,
            style: TextButton.styleFrom(
              foregroundColor: PickforgeColors.error,
            ),
            child: Text(l10n.settingsDeleteForever),
          ),
        ],
      ),
    );
  }
}

/// Routed-page header: back to the workbench + page title. The settings
/// route is reached via `context.go`, so there may be nothing to pop —
/// fall back to navigating home.
class _SettingsHeader extends StatelessWidget {
  const _SettingsHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        PickforgeSpacing.sm,
        PickforgeSpacing.md,
        PickforgeSpacing.lg,
        PickforgeSpacing.md - 2,
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            icon: const Icon(Icons.arrow_back, size: 18),
            onPressed: () {
              if (context.canPop()) {
                context.pop();
              } else {
                context.go(AppRoutes.workbench);
              }
            },
          ),
          const SizedBox(width: PickforgeSpacing.sm),
          Text(title, style: Theme.of(context).textTheme.titleLarge),
        ],
      ),
    );
  }
}

/// Run-log controls: verbosity (persisted, applied live) and a shortcut to
/// the logs folder for bug reports.
class _LogsSection extends StatefulWidget {
  const _LogsSection({required this.logging, required this.settings});

  final AppLogging logging;
  final LogSettingsRepository settings;

  @override
  State<_LogsSection> createState() => _LogsSectionState();
}

class _LogsSectionState extends State<_LogsSection> {
  LogVerbosity? _verbosity;

  @override
  void initState() {
    super.initState();
    unawaited(
      widget.settings.load().then((value) {
        if (mounted) setState(() => _verbosity = value);
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SettingsSection(
      title: l10n.settingsLogsTitle,
      children: [
        Row(
          children: [
            SizedBox(
              width: 136,
              child: Text(
                l10n.settingsLogVerbosity,
                style: Theme.of(context).textTheme.labelMedium,
              ),
            ),
            const SizedBox(width: PickforgeSpacing.md),
            Expanded(
              child: DropdownButtonFormField<LogVerbosity>(
                initialValue: _verbosity ?? LogVerbosity.normal,
                items: [
                  DropdownMenuItem(
                    value: LogVerbosity.normal,
                    child: Text(l10n.settingsLogVerbosityNormal),
                  ),
                  DropdownMenuItem(
                    value: LogVerbosity.verbose,
                    child: Text(l10n.settingsLogVerbosityVerbose),
                  ),
                ],
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => _verbosity = value);
                  widget.logging.setVerbosity(value);
                  unawaited(widget.settings.save(value));
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: PickforgeSpacing.xs),
        Text(
          l10n.settingsLogVerbosityHint,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: PickforgeColors.textMed,
              ),
        ),
        const SizedBox(height: PickforgeSpacing.sm),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            icon: const Icon(Icons.folder_open, size: 16),
            label: Text(l10n.settingsOpenLogsFolder),
            onPressed: () => unawaited(_openLogsFolder()),
          ),
        ),
      ],
    );
  }

  Future<void> _openLogsFolder() async {
    final path = widget.logging.logsDirectory.path;
    final command = switch (Platform.operatingSystem) {
      'macos' => 'open',
      'windows' => 'explorer',
      _ => 'xdg-open',
    };
    try {
      await Process.start(command, [path], mode: ProcessStartMode.detached);
    } on ProcessException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(path)),
      );
    }
  }
}

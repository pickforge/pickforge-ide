import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/models/agent_profile_id.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/terminal/embedded_terminal_settings.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/view/device_run_settings.dart';

class SettingsView extends StatefulWidget {
  const SettingsView({super.key});

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final SettingsCubit _cubit;
  late final DeviceRunSettingsCubit _deviceRunCubit;
  late final String _projectRoot;

  @override
  void initState() {
    super.initState();
    _projectRoot = Directory.current.path;
    _cubit = getIt<SettingsCubit>();
    _deviceRunCubit = DeviceRunSettingsCubit(
      settings: getIt<ProjectSettingsRepository>(),
      discovery: getIt<DeviceDiscoveryService>(),
    );
    _cubit.load(_projectRoot).ignore();
    _deviceRunCubit.load(_projectRoot).ignore();
  }

  @override
  void dispose() {
    _cubit.close().ignore();
    _deviceRunCubit.close().ignore();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider.value(value: _cubit),
        BlocProvider.value(value: _deviceRunCubit),
      ],
      child: BlocBuilder<SettingsCubit, SettingsState>(
        builder: (context, state) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildAgentDropdown(state, context),
                const SizedBox(height: 24),
                DeviceRunSettings(projectRoot: _projectRoot),
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
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildAgentDropdown(SettingsState state, BuildContext context) {
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
                  .setDefaultAgent(_projectRoot, id.value)
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

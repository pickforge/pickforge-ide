import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_state.dart';
import 'package:pickforge/features/settings/widgets/settings_section.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

class DeviceRunSettings extends StatelessWidget {
  const DeviceRunSettings({required this.projectRoot, super.key});

  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<DeviceRunSettingsCubit, DeviceRunSettingsState>(
      builder: (context, state) {
        final binding = state.binding;
        return SettingsSection(
          title: 'Device & Run',
          children: [
            _DeviceDropdown(projectRoot: projectRoot, state: state),
            if (binding is AvdBinding) ...[
              SettingsToggleRow(
                label: 'Auto-boot on select',
                value: binding.autoBootOnSelect,
                onChanged: (value) => context
                    .read<DeviceRunSettingsCubit>()
                    .setAutoBoot(projectRoot, enabled: value)
                    .ignore(),
              ),
              _IdleShutdownFields(
                projectRoot: projectRoot,
                settings: state.idleShutdownSettings,
              ),
              _EmulatorLaunchOptionsFields(
                projectRoot: projectRoot,
                options: state.emulatorLaunchOptions,
              ),
            ],
            _RunArgsFields(
              projectRoot: projectRoot,
              args: state.runArgs,
              targetFiles: state.targetFiles,
              flavors: state.flavors,
            ),
            SettingsField(
              label: 'Connection mode',
              child: SegmentedButton<bool>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: false, label: Text('Auto')),
                  ButtonSegment(value: true, label: Text('Manual')),
                ],
                selected: {binding is ManualBinding},
                onSelectionChanged: (selection) {
                  if (selection.single) {
                    context
                        .read<DeviceRunSettingsCubit>()
                        .switchToManual(projectRoot, 'ws://127.0.0.1:5000/ws')
                        .ignore();
                  }
                },
              ),
            ),
            if (binding is ManualBinding) ...[
              SettingsField(
                label: 'Manual VM Service URL',
                child: SelectableText(binding.vmServiceUrl),
              ),
            ],
            Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                style: settingsCompactButtonStyle(),
                onPressed: () => context
                    .read<DeviceRunSettingsCubit>()
                    .reset(projectRoot)
                    .ignore(),
                icon: const Icon(Icons.restart_alt, size: 16),
                label: const Text('Reset device'),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _IdleShutdownFields extends StatelessWidget {
  const _IdleShutdownFields({
    required this.projectRoot,
    required this.settings,
  });

  final String projectRoot;
  final EmulatorIdleShutdownSettings settings;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SettingsToggleRow(
          switchKey: const Key('emulator-idle-shutdown-enabled'),
          label: 'Shutdown when idle',
          value: settings.enabled,
          onChanged: (value) => _set(
            context,
            settings.copyWith(enabled: value),
          ),
        ),
        if (settings.enabled)
          SettingsToggleRow(
            switchKey: const Key('emulator-idle-shutdown-confirm'),
            label: 'Ask before shutdown',
            value: settings.requireConfirmation,
            onChanged: (value) => _set(
              context,
              settings.copyWith(requireConfirmation: value),
            ),
          ),
      ],
    );
  }

  void _set(BuildContext context, EmulatorIdleShutdownSettings settings) {
    context
        .read<DeviceRunSettingsCubit>()
        .setIdleShutdownSettings(projectRoot, settings)
        .ignore();
  }
}

class _EmulatorLaunchOptionsFields extends StatelessWidget {
  const _EmulatorLaunchOptionsFields({
    required this.projectRoot,
    required this.options,
  });

  final String projectRoot;
  final EmulatorLaunchOptions options;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SettingsToggleRow(
          switchKey: const Key('emulator-no-audio'),
          label: 'No audio',
          value: options.noAudio,
          onChanged: (value) => _set(
            context,
            options.copyWith(noAudio: value),
          ),
        ),
        SettingsToggleRow(
          switchKey: const Key('emulator-no-snapshot-load'),
          label: 'Cold boot',
          value: options.noSnapshotLoad,
          onChanged: (value) => _set(
            context,
            options.copyWith(noSnapshotLoad: value),
          ),
        ),
        const SizedBox(height: PickforgeSpacing.sm),
        DropdownButtonFormField<EmulatorGpuMode?>(
          key: const Key('emulator-gpu-mode'),
          initialValue: options.gpuMode,
          decoration: settingsInputDecoration(labelText: 'GPU mode'),
          items: [
            const DropdownMenuItem<EmulatorGpuMode?>(
              child: Text('Default'),
            ),
            ...EmulatorGpuMode.values.map(
              (mode) => DropdownMenuItem<EmulatorGpuMode?>(
                value: mode,
                child: Text(mode.label),
              ),
            ),
          ],
          onChanged: (mode) => _set(
            context,
            options.copyWith(gpuMode: mode),
          ),
        ),
        const SizedBox(height: PickforgeSpacing.md),
        TextFormField(
          key: ValueKey('emulator-port-${options.port ?? ''}'),
          initialValue: options.port?.toString() ?? '',
          keyboardType: TextInputType.number,
          decoration: settingsInputDecoration(
            labelText: 'Console port',
            helperText: 'Even 5554-5682',
          ),
          onFieldSubmitted: (value) => _setInt(
            context,
            value,
            (port) => options.copyWith(port: port),
          ),
        ),
        const SizedBox(height: PickforgeSpacing.md),
        TextFormField(
          key: ValueKey('emulator-cores-${options.cores ?? ''}'),
          initialValue: options.cores?.toString() ?? '',
          keyboardType: TextInputType.number,
          decoration: settingsInputDecoration(labelText: 'CPU cores'),
          onFieldSubmitted: (value) => _setInt(
            context,
            value,
            (cores) => options.copyWith(cores: cores),
          ),
        ),
      ],
    );
  }

  void _set(BuildContext context, EmulatorLaunchOptions options) {
    context
        .read<DeviceRunSettingsCubit>()
        .setEmulatorLaunchOptions(projectRoot, options)
        .ignore();
  }

  void _setInt(
    BuildContext context,
    String text,
    EmulatorLaunchOptions Function(int?) build,
  ) {
    final trimmed = text.trim();
    final value = trimmed.isEmpty ? null : int.tryParse(trimmed);
    if (value == null && trimmed.isNotEmpty) return;
    _set(context, build(value));
  }
}

class _DeviceDropdown extends StatelessWidget {
  const _DeviceDropdown({required this.projectRoot, required this.state});

  final String projectRoot;
  final DeviceRunSettingsState state;

  @override
  Widget build(BuildContext context) {
    final options = [
      ...state.avds.map(_DeviceOption.avd),
      ...state.runningDevices
          .where(
            (device) => device.isConnectedDevice && device.state == 'device',
          )
          .map(_DeviceOption.connected),
    ];
    final selected = switch (state.binding) {
      AvdBinding(:final avdId) => _DeviceOption.avdKey(avdId),
      PhysicalDeviceBinding(:final serial) => _DeviceOption.physicalKey(serial),
      IosSimulatorBinding(:final simulatorId) =>
        _DeviceOption.iosKey(simulatorId),
      WebTargetBinding(:final targetId) => _DeviceOption.webKey(targetId),
      DesktopTargetBinding(:final targetId) =>
        _DeviceOption.desktopKey(targetId),
      _ => null,
    };
    return DropdownButtonFormField<_DeviceOption>(
      key: const Key('device-dropdown'),
      decoration: settingsInputDecoration(labelText: 'Select Flutter device'),
      initialValue:
          options.where((option) => option.key == selected).firstOrNull,
      isExpanded: true,
      items: options
          .map(
            (option) => DropdownMenuItem(
              value: option,
              child: Text(option.label),
            ),
          )
          .toList(),
      onChanged: (option) {
        if (option == null) return;
        switch (option) {
          case _AvdOption(:final avd):
            context
                .read<DeviceRunSettingsCubit>()
                .setAvd(projectRoot, avd)
                .ignore();
          case _ConnectedDeviceOption(:final device):
            if (device.isIosSimulator) {
              context
                  .read<DeviceRunSettingsCubit>()
                  .setIosSimulator(projectRoot, device)
                  .ignore();
            } else if (device.isWebTarget) {
              context
                  .read<DeviceRunSettingsCubit>()
                  .setWebTarget(projectRoot, device)
                  .ignore();
            } else if (device.isDesktopTarget) {
              context
                  .read<DeviceRunSettingsCubit>()
                  .setDesktopTarget(projectRoot, device)
                  .ignore();
            } else {
              context
                  .read<DeviceRunSettingsCubit>()
                  .setPhysicalDevice(projectRoot, device)
                  .ignore();
            }
        }
      },
    );
  }
}

sealed class _DeviceOption {
  const _DeviceOption();

  factory _DeviceOption.avd(Avd avd) = _AvdOption;
  factory _DeviceOption.connected(RunningAndroidDevice device) =
      _ConnectedDeviceOption;

  String get key;
  String get label;

  static String avdKey(String id) => 'avd:$id';
  static String physicalKey(String serial) => 'physical:$serial';
  static String iosKey(String simulatorId) => 'ios:$simulatorId';
  static String webKey(String targetId) => 'web:$targetId';
  static String desktopKey(String targetId) => 'desktop:$targetId';
}

final class _AvdOption extends _DeviceOption {
  const _AvdOption(this.avd);

  final Avd avd;

  @override
  String get key => avd.platform == iosSimulatorPlatform
      ? _DeviceOption.iosKey(avd.id)
      : avd.platform == flutterWebPlatform
          ? _DeviceOption.webKey(avd.id)
          : avd.platform == flutterDesktopPlatform
              ? _DeviceOption.desktopKey(avd.id)
              : _DeviceOption.avdKey(avd.id);

  @override
  String get label => avd.name;
}

final class _ConnectedDeviceOption extends _DeviceOption {
  const _ConnectedDeviceOption(this.device);

  final RunningAndroidDevice device;

  @override
  String get key => device.isIosSimulator
      ? _DeviceOption.iosKey(device.serial)
      : device.isWebTarget
          ? _DeviceOption.webKey(device.serial)
          : device.isDesktopTarget
              ? _DeviceOption.desktopKey(device.serial)
              : _DeviceOption.physicalKey(device.serial);

  @override
  String get label => '${device.displayName} (${device.serial})';
}

class _RunArgsFields extends StatelessWidget {
  const _RunArgsFields({
    required this.projectRoot,
    required this.args,
    required this.targetFiles,
    required this.flavors,
  });

  final String projectRoot;
  final RunArgs args;
  final List<String> targetFiles;
  final List<String> flavors;

  @override
  Widget build(BuildContext context) {
    final parsed = args.parsed;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DropdownButtonFormField<String>(
          key: const Key('run-target-dropdown'),
          initialValue: _targetValue,
          decoration: settingsInputDecoration(labelText: 'Target file'),
          items: _targetOptions
              .map(
                (target) => DropdownMenuItem(
                  value: target,
                  child: Text(target.isEmpty ? 'Default target' : target),
                ),
              )
              .toList(),
          onChanged: (value) => context
              .read<DeviceRunSettingsCubit>()
              .setRunArgs(projectRoot, args.withTargetFile(value))
              .ignore(),
        ),
        const SizedBox(height: PickforgeSpacing.md),
        SegmentedButton<FlutterBuildMode>(
          key: const Key('run-build-mode'),
          segments: FlutterBuildMode.values
              .map(
                (mode) => ButtonSegment(
                  value: mode,
                  label: Text(mode.label),
                ),
              )
              .toList(),
          selected: {parsed.buildMode},
          onSelectionChanged: (selection) => context
              .read<DeviceRunSettingsCubit>()
              .setRunArgs(projectRoot, args.withBuildMode(selection.single))
              .ignore(),
        ),
        const SizedBox(height: PickforgeSpacing.md),
        TextFormField(
          key: ValueKey('run-flavor-${parsed.flavor ?? ''}'),
          initialValue: parsed.flavor ?? '',
          decoration: settingsInputDecoration(
            labelText: 'Flavor',
            helperText:
                flavors.isEmpty ? null : 'Detected: ${flavors.join(', ')}',
          ),
          onFieldSubmitted: (value) => context
              .read<DeviceRunSettingsCubit>()
              .setRunArgs(projectRoot, args.withFlavor(value))
              .ignore(),
        ),
        if (flavors.isNotEmpty) ...[
          const SizedBox(height: PickforgeSpacing.sm),
          Wrap(
            spacing: PickforgeSpacing.sm,
            runSpacing: PickforgeSpacing.sm,
            children: flavors
                .map(
                  (flavor) => OutlinedButton(
                    style: settingsCompactButtonStyle(),
                    onPressed: () => context
                        .read<DeviceRunSettingsCubit>()
                        .setRunArgs(projectRoot, args.withFlavor(flavor))
                        .ignore(),
                    child: Text(flavor),
                  ),
                )
                .toList(),
          ),
        ],
        const SizedBox(height: PickforgeSpacing.md),
        TextFormField(
          key: ValueKey(
            'run-extra-${parsed.manualExtraArgs.join('\u0000')}',
          ),
          initialValue: formatExtraArgsText(parsed.manualExtraArgs),
          decoration: settingsInputDecoration(
            labelText: 'Extra args',
            helperText: 'Advanced flutter run arguments',
          ),
          onFieldSubmitted: (value) => context
              .read<DeviceRunSettingsCubit>()
              .setRunArgs(
                projectRoot,
                args.withManualExtraArgs(parseExtraArgsText(value)),
              )
              .ignore(),
        ),
      ],
    );
  }

  String get _targetValue {
    final target = args.targetFile;
    if (target == null || target.isEmpty) return '';
    return target;
  }

  List<String> get _targetOptions {
    final options = ['', ...targetFiles];
    final target = args.targetFile;
    if (target != null && target.isNotEmpty && !options.contains(target)) {
      options.add(target);
    }
    return options;
  }
}

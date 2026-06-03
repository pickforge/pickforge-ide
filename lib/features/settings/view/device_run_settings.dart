import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_state.dart';

class DeviceRunSettings extends StatelessWidget {
  const DeviceRunSettings({required this.projectRoot, super.key});

  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<DeviceRunSettingsCubit, DeviceRunSettingsState>(
      builder: (context, state) {
        final binding = state.binding;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Device & Run',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            _AvdDropdown(projectRoot: projectRoot, state: state),
            const SizedBox(height: 8),
            if (binding is AvdBinding)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Auto-boot on select'),
                value: binding.autoBootOnSelect,
                onChanged: (value) => context
                    .read<DeviceRunSettingsCubit>()
                    .setAutoBoot(projectRoot, enabled: value)
                    .ignore(),
              ),
            const SizedBox(height: 8),
            _RunArgsFields(
              projectRoot: projectRoot,
              args: state.runArgs,
              targetFiles: state.targetFiles,
              flavors: state.flavors,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Text('Connection mode: '),
                ChoiceChip(
                  label: const Text('Auto'),
                  selected: binding is! ManualBinding,
                  onSelected: (_) {},
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  label: const Text('Manual'),
                  selected: binding is ManualBinding,
                  onSelected: (_) => context
                      .read<DeviceRunSettingsCubit>()
                      .switchToManual(projectRoot, 'ws://127.0.0.1:5000/ws')
                      .ignore(),
                ),
              ],
            ),
            if (binding is ManualBinding) ...[
              const SizedBox(height: 8),
              const Text('Manual VM Service URL'),
              SelectableText(binding.vmServiceUrl),
            ],
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => context
                  .read<DeviceRunSettingsCubit>()
                  .reset(projectRoot)
                  .ignore(),
              child: const Text('Reset device'),
            ),
          ],
        );
      },
    );
  }
}

class _AvdDropdown extends StatelessWidget {
  const _AvdDropdown({required this.projectRoot, required this.state});

  final String projectRoot;
  final DeviceRunSettingsState state;

  @override
  Widget build(BuildContext context) {
    final selected = state.binding is AvdBinding
        ? (state.binding! as AvdBinding).avdId
        : null;
    return DropdownButton<Avd>(
      hint: const Text('Select Android emulator'),
      value: state.avds.where((avd) => avd.id == selected).firstOrNull,
      items: state.avds
          .map((avd) => DropdownMenuItem(value: avd, child: Text(avd.name)))
          .toList(),
      onChanged: (avd) {
        if (avd == null) return;
        context
            .read<DeviceRunSettingsCubit>()
            .setAvd(projectRoot, avd)
            .ignore();
      },
    );
  }
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
          decoration: const InputDecoration(labelText: 'Target file'),
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
        const SizedBox(height: 12),
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
        const SizedBox(height: 12),
        TextFormField(
          key: ValueKey('run-flavor-${parsed.flavor ?? ''}'),
          initialValue: parsed.flavor ?? '',
          decoration: InputDecoration(
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
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: flavors
                .map(
                  (flavor) => ActionChip(
                    label: Text(flavor),
                    onPressed: () => context
                        .read<DeviceRunSettingsCubit>()
                        .setRunArgs(projectRoot, args.withFlavor(flavor))
                        .ignore(),
                  ),
                )
                .toList(),
          ),
        ],
        const SizedBox(height: 12),
        TextFormField(
          key: ValueKey(
            'run-extra-${parsed.manualExtraArgs.join('\u0000')}',
          ),
          initialValue: formatExtraArgsText(parsed.manualExtraArgs),
          decoration: const InputDecoration(
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

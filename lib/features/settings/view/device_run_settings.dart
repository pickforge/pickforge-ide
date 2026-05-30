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
            _RunArgsFields(projectRoot: projectRoot, args: state.runArgs),
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
  const _RunArgsFields({required this.projectRoot, required this.args});

  final String projectRoot;
  final RunArgs args;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextFormField(
          initialValue: args.targetFile ?? '',
          decoration: const InputDecoration(labelText: 'Target file'),
          onFieldSubmitted: (value) => context
              .read<DeviceRunSettingsCubit>()
              .setRunArgs(
                projectRoot,
                args.copyWith(targetFile: value.isEmpty ? null : value),
              )
              .ignore(),
        ),
        const SizedBox(height: 8),
        Text('Extra args: ${args.extraArgs.join(' ')}'),
      ],
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_state.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';

class DevicePickerMenu extends StatefulWidget {
  const DevicePickerMenu({super.key});

  @override
  State<DevicePickerMenu> createState() => _DevicePickerMenuState();
}

class _DevicePickerMenuState extends State<DevicePickerMenu> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(context.read<DevicePickerCubit>().refresh());
    });
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 320,
      child: BlocBuilder<DevicePickerCubit, DevicePickerState>(
        builder: (context, state) => switch (state) {
          Initial() || Loading() => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
          Loaded(:final avds, :final running) =>
            _DeviceList(avds: avds, running: running),
          PickerError(:final message) => Padding(
              padding: const EdgeInsets.all(24),
              child: Text(message),
            ),
        },
      ),
    );
  }
}

class _DeviceList extends StatelessWidget {
  const _DeviceList({required this.avds, required this.running});

  final List<Avd> avds;
  final List<RunningAndroidDevice> running;

  @override
  Widget build(BuildContext context) {
    final session = context.read<EmulatorSessionCubit>();
    final physicalDevices = running
        .where((device) => device.isPhysical && device.state == 'device')
        .toList();
    final runningAvds =
        avds.where((avd) => running.any((r) => r.avdName == avd.id)).toList();
    final coldAvds =
        avds.where((avd) => !running.any((r) => r.avdName == avd.id)).toList();

    if (avds.isEmpty && physicalDevices.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'No Android devices detected.\n'
          'Connect a device or create an emulator in Android Studio.',
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (physicalDevices.isNotEmpty) const _Header('CONNECTED'),
        for (final device in physicalDevices)
          _DeviceRow(
            label: '${device.displayName} (${device.serial})',
            onTap: () => unawaited(_pickPhysical(context, session, device)),
          ),
        if (runningAvds.isNotEmpty) const _Header('RUNNING'),
        for (final avd in runningAvds)
          _DeviceRow(
            label: avd.name,
            onTap: () => unawaited(_pick(context, session, avd)),
          ),
        if (coldAvds.isNotEmpty) const _Header('AVAILABLE'),
        for (final avd in coldAvds)
          _DeviceRow(
            label: avd.name,
            onTap: () => unawaited(_pick(context, session, avd)),
          ),
      ],
    );
  }

  Future<void> _pick(
    BuildContext context,
    EmulatorSessionCubit session,
    Avd avd,
  ) async {
    await Navigator.of(context).maybePop();
    await session.pickAvd(avd);
  }

  Future<void> _pickPhysical(
    BuildContext context,
    EmulatorSessionCubit session,
    RunningAndroidDevice device,
  ) async {
    await Navigator.of(context).maybePop();
    await session.pickPhysicalDevice(device);
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
        child: Text(text, style: Theme.of(context).textTheme.labelSmall),
      );
}

class _DeviceRow extends StatelessWidget {
  const _DeviceRow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) =>
      ListTile(title: Text(label), onTap: onTap, dense: true);
}

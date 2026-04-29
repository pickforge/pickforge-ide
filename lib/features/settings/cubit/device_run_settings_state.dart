import 'package:equatable/equatable.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';

class DeviceRunSettingsState extends Equatable {
  const DeviceRunSettingsState({
    this.binding,
    this.runArgs = const RunArgs(),
    this.avds = const [],
  });

  final EmulatorBinding? binding;
  final RunArgs runArgs;
  final List<Avd> avds;

  DeviceRunSettingsState copyWith({
    Object? binding = _unset,
    RunArgs? runArgs,
    List<Avd>? avds,
  }) =>
      DeviceRunSettingsState(
        binding: binding == _unset ? this.binding : binding as EmulatorBinding?,
        runArgs: runArgs ?? this.runArgs,
        avds: avds ?? this.avds,
      );

  @override
  List<Object?> get props => [binding, runArgs, avds];
}

const _unset = Object();

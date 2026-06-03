import 'package:equatable/equatable.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/run_args.dart';

class DeviceRunSettingsState extends Equatable {
  const DeviceRunSettingsState({
    this.binding,
    this.runArgs = const RunArgs(),
    this.emulatorLaunchOptions = const EmulatorLaunchOptions(),
    this.avds = const [],
    this.targetFiles = const [],
    this.flavors = const [],
  });

  final EmulatorBinding? binding;
  final RunArgs runArgs;
  final EmulatorLaunchOptions emulatorLaunchOptions;
  final List<Avd> avds;
  final List<String> targetFiles;
  final List<String> flavors;

  DeviceRunSettingsState copyWith({
    Object? binding = _unset,
    RunArgs? runArgs,
    EmulatorLaunchOptions? emulatorLaunchOptions,
    List<Avd>? avds,
    List<String>? targetFiles,
    List<String>? flavors,
  }) =>
      DeviceRunSettingsState(
        binding: binding == _unset ? this.binding : binding as EmulatorBinding?,
        runArgs: runArgs ?? this.runArgs,
        emulatorLaunchOptions:
            emulatorLaunchOptions ?? this.emulatorLaunchOptions,
        avds: avds ?? this.avds,
        targetFiles: targetFiles ?? this.targetFiles,
        flavors: flavors ?? this.flavors,
      );

  @override
  List<Object?> get props => [
        binding,
        runArgs,
        emulatorLaunchOptions,
        avds,
        targetFiles,
        flavors,
      ];
}

const _unset = Object();

import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/flutter_run_target_scanner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_state.dart';

@injectable
class DeviceRunSettingsCubit extends Cubit<DeviceRunSettingsState> {
  DeviceRunSettingsCubit({
    required this.settings,
    required this.discovery,
    this.targetScanner = const FlutterRunTargetScanner(),
  }) : super(const DeviceRunSettingsState());

  final ProjectSettingsRepository settings;
  final DeviceDiscoveryService discovery;
  final FlutterRunTargetScanner targetScanner;
  int _loadGeneration = 0;

  Future<void> load(String projectRoot) async {
    final generation = ++_loadGeneration;
    final results = await Future.wait<Object?>([
      settings.getEmulatorBinding(projectRoot),
      settings.getRunArgs(projectRoot),
      settings.getEmulatorLaunchOptions(projectRoot),
      settings.getEmulatorIdleShutdownSettings(projectRoot),
      discovery.snapshot(),
      targetScanner.scan(projectRoot),
    ]);
    if (isClosed || generation != _loadGeneration) return;
    final binding = results[0] as EmulatorBinding?;
    final runArgs = results[1]! as RunArgs;
    final launchOptions = results[2]! as EmulatorLaunchOptions;
    final idleShutdown = results[3]! as EmulatorIdleShutdownSettings;
    final devices = results[4]! as DeviceListSnapshot;
    final metadata = results[5]! as FlutterRunMetadata;
    emit(
      DeviceRunSettingsState(
        binding: binding,
        runArgs: runArgs,
        emulatorLaunchOptions: launchOptions,
        idleShutdownSettings: idleShutdown,
        avds: devices.avds,
        runningDevices: devices.running,
        targetFiles: metadata.targetFiles,
        flavors: metadata.flavors,
      ),
    );
  }

  Future<void> setAvd(String projectRoot, Avd avd) async {
    final binding = EmulatorBinding.avd(avdId: avd.id, avdName: avd.name);
    await settings.setEmulatorBinding(projectRoot, binding);
    emit(state.copyWith(binding: binding));
  }

  Future<void> setPhysicalDevice(
    String projectRoot,
    RunningAndroidDevice device,
  ) async {
    final binding = EmulatorBinding.physical(
      serial: device.serial,
      name: device.displayName,
    );
    await settings.setEmulatorBinding(projectRoot, binding);
    emit(state.copyWith(binding: binding));
  }

  Future<void> setAutoBoot(
    String projectRoot, {
    required bool enabled,
  }) async {
    final current = state.binding;
    if (current is! AvdBinding) return;
    final binding = EmulatorBinding.avd(
      avdId: current.avdId,
      avdName: current.avdName,
      autoBootOnSelect: enabled,
    );
    await settings.setEmulatorBinding(projectRoot, binding);
    emit(state.copyWith(binding: binding));
  }

  Future<void> setRunArgs(String projectRoot, RunArgs args) async {
    await settings.setRunArgs(projectRoot, args);
    emit(state.copyWith(runArgs: args));
  }

  Future<void> setEmulatorLaunchOptions(
    String projectRoot,
    EmulatorLaunchOptions options,
  ) async {
    if (options.validationErrors.isNotEmpty) return;
    await settings.setEmulatorLaunchOptions(projectRoot, options);
    emit(state.copyWith(emulatorLaunchOptions: options));
  }

  Future<void> setIdleShutdownSettings(
    String projectRoot,
    EmulatorIdleShutdownSettings idleShutdown,
  ) async {
    await settings.setEmulatorIdleShutdownSettings(projectRoot, idleShutdown);
    emit(state.copyWith(idleShutdownSettings: idleShutdown));
  }

  Future<void> switchToManual(String projectRoot, String url) async {
    final binding = EmulatorBinding.manual(vmServiceUrl: url);
    await settings.setEmulatorBinding(projectRoot, binding);
    emit(state.copyWith(binding: binding));
  }

  Future<void> reset(String projectRoot) async {
    await settings.clearEmulatorBinding(projectRoot);
    await settings.setRunArgs(projectRoot, const RunArgs());
    await settings.setEmulatorLaunchOptions(
      projectRoot,
      const EmulatorLaunchOptions(),
    );
    await settings.setEmulatorIdleShutdownSettings(
      projectRoot,
      const EmulatorIdleShutdownSettings(),
    );
    emit(
      state.copyWith(
        binding: null,
        runArgs: const RunArgs(),
        emulatorLaunchOptions: const EmulatorLaunchOptions(),
        idleShutdownSettings: const EmulatorIdleShutdownSettings(),
      ),
    );
  }
}

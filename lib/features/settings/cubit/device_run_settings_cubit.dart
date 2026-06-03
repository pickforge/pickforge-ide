import 'package:bloc/bloc.dart';
import 'package:injectable/injectable.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
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
      discovery.snapshot(),
      targetScanner.scan(projectRoot),
    ]);
    if (isClosed || generation != _loadGeneration) return;
    final binding = results[0] as EmulatorBinding?;
    final runArgs = results[1]! as RunArgs;
    final devices = results[2]! as DeviceListSnapshot;
    final metadata = results[3]! as FlutterRunMetadata;
    emit(
      DeviceRunSettingsState(
        binding: binding,
        runArgs: runArgs,
        avds: devices.avds,
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

  Future<void> switchToManual(String projectRoot, String url) async {
    final binding = EmulatorBinding.manual(vmServiceUrl: url);
    await settings.setEmulatorBinding(projectRoot, binding);
    emit(state.copyWith(binding: binding));
  }

  Future<void> reset(String projectRoot) async {
    await settings.clearEmulatorBinding(projectRoot);
    await settings.setRunArgs(projectRoot, const RunArgs());
    emit(state.copyWith(binding: null, runArgs: const RunArgs()));
  }
}

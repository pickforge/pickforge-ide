import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/flutter_run_target_scanner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';
import 'package:pickforge/features/settings/cubit/device_run_settings_cubit.dart';

class _SettingsRepo extends Mock implements ProjectSettingsRepository {}

class _Discovery extends Mock implements DeviceDiscoveryService {}

class _Scanner extends FlutterRunTargetScanner {
  const _Scanner(this.metadata);

  final FlutterRunMetadata metadata;

  @override
  Future<FlutterRunMetadata> scan(String projectRoot) async => metadata;
}

void main() {
  late _SettingsRepo repo;
  late _Discovery discovery;

  setUpAll(() {
    registerFallbackValue(
      const EmulatorBinding.avd(avdId: 'fallback', avdName: 'fallback'),
    );
    registerFallbackValue(const EmulatorLaunchOptions());
    registerFallbackValue(const EmulatorIdleShutdownSettings());
  });

  setUp(() {
    repo = _SettingsRepo();
    discovery = _Discovery();
  });

  test('load reads binding, run args, and AVDs', () async {
    when(() => repo.getEmulatorBinding('/p')).thenAnswer(
      (_) async => const EmulatorBinding.avd(avdId: 'p5', avdName: 'Pixel 5'),
    );
    when(() => repo.getRunArgs('/p')).thenAnswer(
      (_) async => const RunArgs(
        targetFile: 'lib/main_dev.dart',
        extraArgs: ['--flavor', 'dev'],
      ),
    );
    when(() => repo.getEmulatorLaunchOptions('/p')).thenAnswer(
      (_) async => const EmulatorLaunchOptions(noAudio: true),
    );
    when(() => repo.getEmulatorIdleShutdownSettings('/p')).thenAnswer(
      (_) async => const EmulatorIdleShutdownSettings(enabled: true),
    );
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(
        avds: [Avd(id: 'p5', name: 'Pixel 5', platform: 'android')],
        running: [
          RunningAndroidDevice(
            serial: 'R58M1234567',
            avdName: null,
            state: 'device',
            kind: AndroidDeviceKind.physical,
            model: 'Pixel 6',
          ),
        ],
      ),
    );

    final cubit = DeviceRunSettingsCubit(
      settings: repo,
      discovery: discovery,
      targetScanner: const _Scanner(
        FlutterRunMetadata(
          targetFiles: ['lib/main.dart', 'lib/main_dev.dart'],
          flavors: ['dev'],
        ),
      ),
    );
    await cubit.load('/p');

    expect(cubit.state.binding, isA<AvdBinding>());
    expect(cubit.state.runArgs.targetFile, 'lib/main_dev.dart');
    expect(cubit.state.emulatorLaunchOptions.noAudio, isTrue);
    expect(cubit.state.idleShutdownSettings.enabled, isTrue);
    expect(cubit.state.avds.single.name, 'Pixel 5');
    expect(cubit.state.runningDevices.single.serial, 'R58M1234567');
    expect(cubit.state.targetFiles, ['lib/main.dart', 'lib/main_dev.dart']);
    expect(cubit.state.flavors, ['dev']);
  });

  test('ignores stale load completions', () async {
    final first = Completer<EmulatorBinding?>();
    final second = Completer<EmulatorBinding?>();
    when(() => repo.getEmulatorBinding('/first'))
        .thenAnswer((_) => first.future);
    when(() => repo.getEmulatorBinding('/second'))
        .thenAnswer((_) => second.future);
    when(() => repo.getRunArgs(any())).thenAnswer((_) async => const RunArgs());
    when(() => repo.getEmulatorLaunchOptions(any()))
        .thenAnswer((_) async => const EmulatorLaunchOptions());
    when(() => repo.getEmulatorIdleShutdownSettings(any()))
        .thenAnswer((_) async => const EmulatorIdleShutdownSettings());
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(
        avds: [Avd(id: 'p5', name: 'Pixel 5', platform: 'android')],
        running: [],
      ),
    );

    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);
    final firstLoad = cubit.load('/first');
    final secondLoad = cubit.load('/second');

    second.complete(
      const EmulatorBinding.avd(avdId: 'second', avdName: 'Second'),
    );
    await secondLoad;
    expect((cubit.state.binding! as AvdBinding).avdId, 'second');

    first.complete(const EmulatorBinding.avd(avdId: 'first', avdName: 'First'));
    await firstLoad;
    expect((cubit.state.binding! as AvdBinding).avdId, 'second');
  });

  test('load completion after close is ignored', () async {
    final binding = Completer<EmulatorBinding?>();
    when(() => repo.getEmulatorBinding('/p')).thenAnswer((_) => binding.future);
    when(() => repo.getRunArgs('/p')).thenAnswer((_) async => const RunArgs());
    when(() => repo.getEmulatorLaunchOptions('/p'))
        .thenAnswer((_) async => const EmulatorLaunchOptions());
    when(() => repo.getEmulatorIdleShutdownSettings('/p'))
        .thenAnswer((_) async => const EmulatorIdleShutdownSettings());
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(avds: [], running: []),
    );

    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);
    final load = cubit.load('/p');
    await cubit.close();

    binding.complete(
      const EmulatorBinding.avd(avdId: 'p5', avdName: 'Pixel 5'),
    );
    await load;
  });

  test('setAvd persists AVD binding', () async {
    when(() => repo.setEmulatorBinding('/p', any())).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setAvd(
      '/p',
      const Avd(id: 'p7', name: 'Pixel 7', platform: 'android'),
    );

    verify(
      () => repo.setEmulatorBinding(
        '/p',
        const EmulatorBinding.avd(avdId: 'p7', avdName: 'Pixel 7'),
      ),
    ).called(1);
    expect((cubit.state.binding! as AvdBinding).avdId, 'p7');
  });

  test('setPhysicalDevice persists physical binding', () async {
    when(() => repo.setEmulatorBinding('/p', any())).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setPhysicalDevice(
      '/p',
      const RunningAndroidDevice(
        serial: 'R58M1234567',
        avdName: null,
        state: 'device',
        kind: AndroidDeviceKind.physical,
        model: 'Pixel 6',
      ),
    );

    verify(
      () => repo.setEmulatorBinding(
        '/p',
        const EmulatorBinding.physical(
          serial: 'R58M1234567',
          name: 'Pixel 6',
        ),
      ),
    ).called(1);
    expect(
      (cubit.state.binding! as PhysicalDeviceBinding).serial,
      'R58M1234567',
    );
  });

  test('setRunArgs persists args', () async {
    const args = RunArgs(targetFile: 'test/main.dart', extraArgs: ['--debug']);
    when(() => repo.setRunArgs('/p', args)).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setRunArgs('/p', args);

    verify(() => repo.setRunArgs('/p', args)).called(1);
    expect(cubit.state.runArgs, args);
  });

  test('setEmulatorLaunchOptions persists options', () async {
    const options = EmulatorLaunchOptions(
      noAudio: true,
      gpuMode: EmulatorGpuMode.host,
      port: 5556,
    );
    when(() => repo.setEmulatorLaunchOptions('/p', options))
        .thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setEmulatorLaunchOptions('/p', options);

    verify(() => repo.setEmulatorLaunchOptions('/p', options)).called(1);
    expect(cubit.state.emulatorLaunchOptions, options);
  });

  test('setEmulatorLaunchOptions ignores invalid options', () async {
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setEmulatorLaunchOptions(
      '/p',
      const EmulatorLaunchOptions(port: 5555),
    );

    verifyNever(() => repo.setEmulatorLaunchOptions(any(), any()));
    expect(cubit.state.emulatorLaunchOptions, const EmulatorLaunchOptions());
  });

  test('setIdleShutdownSettings persists settings', () async {
    const idleShutdown = EmulatorIdleShutdownSettings(
      enabled: true,
      requireConfirmation: false,
    );
    when(() => repo.setEmulatorIdleShutdownSettings('/p', idleShutdown))
        .thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setIdleShutdownSettings('/p', idleShutdown);

    verify(
      () => repo.setEmulatorIdleShutdownSettings('/p', idleShutdown),
    ).called(1);
    expect(cubit.state.idleShutdownSettings, idleShutdown);
  });

  test('reset clears binding and run args', () async {
    when(() => repo.clearEmulatorBinding('/p')).thenAnswer((_) async {});
    when(() => repo.setRunArgs('/p', const RunArgs())).thenAnswer((_) async {});
    when(
      () => repo.setEmulatorLaunchOptions('/p', const EmulatorLaunchOptions()),
    ).thenAnswer((_) async {});
    when(
      () => repo.setEmulatorIdleShutdownSettings(
        '/p',
        const EmulatorIdleShutdownSettings(),
      ),
    ).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.reset('/p');

    verify(() => repo.clearEmulatorBinding('/p')).called(1);
    verify(() => repo.setRunArgs('/p', const RunArgs())).called(1);
    verify(
      () => repo.setEmulatorLaunchOptions('/p', const EmulatorLaunchOptions()),
    ).called(1);
    verify(
      () => repo.setEmulatorIdleShutdownSettings(
        '/p',
        const EmulatorIdleShutdownSettings(),
      ),
    ).called(1);
    expect(cubit.state.binding, isNull);
    expect(cubit.state.runArgs, const RunArgs());
    expect(cubit.state.emulatorLaunchOptions, const EmulatorLaunchOptions());
    expect(
      cubit.state.idleShutdownSettings,
      const EmulatorIdleShutdownSettings(),
    );
  });
}

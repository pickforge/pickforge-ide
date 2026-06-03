import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/device_models.dart';
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
    when(discovery.snapshot).thenAnswer(
      (_) async => const DeviceListSnapshot(
        avds: [Avd(id: 'p5', name: 'Pixel 5', platform: 'android')],
        running: [],
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
    expect(cubit.state.avds.single.name, 'Pixel 5');
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

  test('setRunArgs persists args', () async {
    const args = RunArgs(targetFile: 'test/main.dart', extraArgs: ['--debug']);
    when(() => repo.setRunArgs('/p', args)).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.setRunArgs('/p', args);

    verify(() => repo.setRunArgs('/p', args)).called(1);
    expect(cubit.state.runArgs, args);
  });

  test('reset clears binding and run args', () async {
    when(() => repo.clearEmulatorBinding('/p')).thenAnswer((_) async {});
    when(() => repo.setRunArgs('/p', const RunArgs())).thenAnswer((_) async {});
    final cubit = DeviceRunSettingsCubit(settings: repo, discovery: discovery);

    await cubit.reset('/p');

    verify(() => repo.clearEmulatorBinding('/p')).called(1);
    verify(() => repo.setRunArgs('/p', const RunArgs())).called(1);
    expect(cubit.state.binding, isNull);
    expect(cubit.state.runArgs, const RunArgs());
  });
}

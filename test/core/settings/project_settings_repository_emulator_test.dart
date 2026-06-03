import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';
import 'package:pickforge/core/emulator/emulator_launch_options.dart';
import 'package:pickforge/core/settings/emulator_binding.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/settings/run_args.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectSettingsRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectSettingsRepository(db);
  });
  tearDown(() => db.close());

  test('round-trip AVD binding', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.avd(
        avdId: 'Pixel_5_API_34',
        avdName: 'Pixel 5 API 34',
        autoBootOnSelect: false,
      ),
    );
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<AvdBinding>());
    expect((got! as AvdBinding).avdId, 'Pixel_5_API_34');
    expect((got as AvdBinding).autoBootOnSelect, isFalse);
  });

  test('round-trip manual binding', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.manual(vmServiceUrl: 'ws://x/ws'),
    );
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<ManualBinding>());
    expect((got! as ManualBinding).vmServiceUrl, 'ws://x/ws');
  });

  test('round-trip physical device binding', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.physical(
        serial: 'R58M1234567',
        name: 'Pixel 6',
      ),
    );
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<PhysicalDeviceBinding>());
    expect((got! as PhysicalDeviceBinding).serial, 'R58M1234567');
    expect((got as PhysicalDeviceBinding).name, 'Pixel 6');
  });

  test('round-trip iOS simulator binding', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.iosSimulator(
        simulatorId: 'A1B2C3D4-0000-1111-2222-333344445555',
        name: 'iPhone 16',
      ),
    );
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<IosSimulatorBinding>());
    expect(
      (got! as IosSimulatorBinding).simulatorId,
      'A1B2C3D4-0000-1111-2222-333344445555',
    );
    expect((got as IosSimulatorBinding).name, 'iPhone 16');
  });

  test('round-trip web target binding', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.webTarget(
        targetId: 'chrome',
        name: 'Chrome',
      ),
    );
    final got = await repo.getEmulatorBinding('/p');
    expect(got, isA<WebTargetBinding>());
    expect((got! as WebTargetBinding).targetId, 'chrome');
    expect((got as WebTargetBinding).name, 'Chrome');
  });

  test('clearEmulatorBinding returns null', () async {
    await repo.setEmulatorBinding(
      '/p',
      const EmulatorBinding.avd(avdId: 'X', avdName: 'Y'),
    );
    await repo.clearEmulatorBinding('/p');
    expect(await repo.getEmulatorBinding('/p'), isNull);
  });

  test('round-trip run args (JSON-encoded extraArgs)', () async {
    await repo.setRunArgs(
      '/p',
      const RunArgs(
        targetFile: 'lib/main_dev.dart',
        extraArgs: ['--flavor', 'dev', '--dart-define=FOO=bar'],
      ),
    );
    final got = await repo.getRunArgs('/p');
    expect(got.targetFile, 'lib/main_dev.dart');
    expect(got.extraArgs, ['--flavor', 'dev', '--dart-define=FOO=bar']);
  });

  test('getRunArgs returns empty when none set', () async {
    final got = await repo.getRunArgs('/p');
    expect(got.targetFile, isNull);
    expect(got.extraArgs, isEmpty);
  });

  test('round-trip emulator launch options', () async {
    await repo.setEmulatorLaunchOptions(
      '/p',
      const EmulatorLaunchOptions(
        noAudio: true,
        gpuMode: EmulatorGpuMode.host,
        noSnapshotLoad: true,
        port: 5556,
        cores: 4,
      ),
    );

    final got = await repo.getEmulatorLaunchOptions('/p');
    expect(got.noAudio, isTrue);
    expect(got.gpuMode, EmulatorGpuMode.host);
    expect(got.noSnapshotLoad, isTrue);
    expect(got.port, 5556);
    expect(got.cores, 4);
  });

  test('getEmulatorLaunchOptions returns defaults when none set', () async {
    expect(
      await repo.getEmulatorLaunchOptions('/p'),
      const EmulatorLaunchOptions(),
    );
  });

  test('setEmulatorLaunchOptions clears stored JSON for defaults', () async {
    await repo.setEmulatorLaunchOptions(
      '/p',
      const EmulatorLaunchOptions(noAudio: true),
    );
    await repo.setEmulatorLaunchOptions('/p', const EmulatorLaunchOptions());

    final row = await db.projectSettingsDao.loadFor('/p');
    expect(row?.emulatorLaunchOptions, isNull);
    expect(
      await repo.getEmulatorLaunchOptions('/p'),
      const EmulatorLaunchOptions(),
    );
  });

  test('setEmulatorLaunchOptions rejects invalid options', () {
    expect(
      () => repo.setEmulatorLaunchOptions(
        '/p',
        const EmulatorLaunchOptions(port: 5555),
      ),
      throwsArgumentError,
    );
  });

  test('round-trip idle shutdown settings', () async {
    await repo.setEmulatorIdleShutdownSettings(
      '/p',
      const EmulatorIdleShutdownSettings(
        enabled: true,
        requireConfirmation: false,
      ),
    );

    final got = await repo.getEmulatorIdleShutdownSettings('/p');
    expect(got.enabled, isTrue);
    expect(got.requireConfirmation, isFalse);
  });

  test('getEmulatorIdleShutdownSettings returns defaults when none set',
      () async {
    expect(
      await repo.getEmulatorIdleShutdownSettings('/p'),
      const EmulatorIdleShutdownSettings(),
    );
  });

  test('setEmulatorIdleShutdownSettings clears stored JSON for defaults',
      () async {
    await repo.setEmulatorIdleShutdownSettings(
      '/p',
      const EmulatorIdleShutdownSettings(enabled: true),
    );
    await repo.setEmulatorIdleShutdownSettings(
      '/p',
      const EmulatorIdleShutdownSettings(),
    );

    final row = await db.projectSettingsDao.loadFor('/p');
    expect(row?.emulatorIdleShutdown, isNull);
    expect(
      await repo.getEmulatorIdleShutdownSettings('/p'),
      const EmulatorIdleShutdownSettings(),
    );
  });
}

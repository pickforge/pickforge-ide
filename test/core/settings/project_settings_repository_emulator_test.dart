import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
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
}

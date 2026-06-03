import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test(
      'upsert + read avdId, avdName, connectionMode, runArgs, target, autoBoot',
      () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/tmp/p',
      avdId: const Value('Pixel_5_API_34'),
      avdName: const Value('Pixel 5 API 34'),
      connectionMode: const Value('auto'),
      flutterRunArgs: const Value('["--flavor","dev"]'),
      targetFile: const Value('lib/main_dev.dart'),
      emulatorLaunchOptions: const Value('{"noAudio":true}'),
      autoBootOnSelect: true,
    );
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row, isNotNull);
    expect(row!.avdId, 'Pixel_5_API_34');
    expect(row.avdName, 'Pixel 5 API 34');
    expect(row.connectionMode, 'auto');
    expect(row.flutterRunArgs, '["--flavor","dev"]');
    expect(row.targetFile, 'lib/main_dev.dart');
    expect(row.emulatorLaunchOptions, '{"noAudio":true}');
    expect(row.autoBootOnSelect, true);
    expect(row.firstRunCelebrated, false);
  });

  test('clearEmulatorBinding nulls out columns', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/tmp/p',
      avdId: const Value('X'),
      avdName: const Value('Y'),
    );
    await db.projectSettingsDao.clearEmulatorBinding('/tmp/p');
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row?.avdId, isNull);
    expect(row?.avdName, isNull);
    expect(row?.vmServiceUrl, isNull);
  });

  test('markFirstRunCelebrated flips flag', () async {
    await db.projectSettingsDao.upsert(projectRoot: '/tmp/p');
    await db.projectSettingsDao.markFirstRunCelebrated('/tmp/p');
    final row = await db.projectSettingsDao.loadFor('/tmp/p');
    expect(row?.firstRunCelebrated, true);
  });
}

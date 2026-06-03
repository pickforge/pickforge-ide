import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';

void main() {
  late PickforgeDatabase db;
  late RunSessionLogRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = RunSessionLogRepository(db);
  });
  tearDown(() => db.close());

  test('recordStart inserts row', () async {
    await repo.recordStart(
      sessionId: 's1',
      projectRoot: '/p',
      startedAt: DateTime.utc(2026, 4, 28),
      avdId: 'A',
      avdName: 'B',
      serial: 'emulator-5554',
      vmServiceUrl: 'ws://x',
      targetFile: 'lib/main_dev.dart',
      connectionMode: 'auto',
    );
    final got = await repo.latestFor('/p');
    expect(got?.sessionId, 's1');
    expect(got?.targetFile, 'lib/main_dev.dart');
  });

  test('recordVmServiceUrl updates latest row', () async {
    await repo.recordStart(
      sessionId: 's1',
      projectRoot: '/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await repo.recordVmServiceUrl(sessionId: 's1', vmServiceUrl: 'ws://ready');
    final got = await repo.latestFor('/p');
    expect(got?.vmServiceUrl, 'ws://ready');
  });

  test('recordEnd is idempotent', () async {
    await repo.recordStart(
      sessionId: 's1',
      projectRoot: '/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await repo.recordEnd(
      sessionId: 's1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'crash',
      hotReloadCount: 1,
    );
    await repo.recordEnd(
      sessionId: 's1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'pickforge_quit',
      hotReloadCount: 2,
    );
    final got = await repo.latestFor('/p');
    expect(got?.exitReason, 'pickforge_quit');
    expect(got?.hotReloadCount, 2);
  });

  test('recordStart prunes when over cap', () async {
    for (var i = 0; i < 5; i++) {
      await repo.recordStart(
        sessionId: 's$i',
        projectRoot: '/p',
        startedAt: DateTime.utc(2026, 4, i + 1),
        connectionMode: 'auto',
      );
    }
    await repo.applyCap('/p', cap: 2);
    final list = await repo.recentFor('/p');
    expect(list.map((r) => r.sessionId), ['s4', 's3']);
  });
}

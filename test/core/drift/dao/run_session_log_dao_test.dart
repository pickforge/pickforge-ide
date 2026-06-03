import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('recordStart inserts row, recordEnd updates same row', () async {
    final start = DateTime.utc(2026, 4, 28, 14, 30);
    await db.runSessionLogDao.recordStart(
      sessionId: 'ses-1',
      projectRoot: '/tmp/p',
      startedAt: start,
      avdId: 'Pixel_5_API_34',
      avdName: 'Pixel 5 API 34',
      serial: 'emulator-5554',
      vmServiceUrl: 'ws://x/ws',
      targetFile: 'lib/main_dev.dart',
      connectionMode: 'auto',
    );
    final end = start.add(const Duration(minutes: 5));
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: end,
      exitReason: 'user_stop',
      hotReloadCount: 3,
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows, hasLength(1));
    expect(rows.single.exitReason, 'user_stop');
    expect(rows.single.hotReloadCount, 3);
    expect(rows.single.targetFile, 'lib/main_dev.dart');
  });

  test('recordVmServiceUrl updates started row', () async {
    await db.runSessionLogDao.recordStart(
      sessionId: 'ses-1',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await db.runSessionLogDao.recordVmServiceUrl(
      sessionId: 'ses-1',
      vmServiceUrl: 'ws://ready/ws',
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows.single.vmServiceUrl, 'ws://ready/ws');
  });

  test('recordEnd is idempotent on same sessionId', () async {
    await db.runSessionLogDao.recordStart(
      sessionId: 'ses-1',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'crash',
    );
    await db.runSessionLogDao.recordEnd(
      sessionId: 'ses-1',
      endedAt: DateTime.utc(2026, 4, 28),
      exitReason: 'pickforge_quit',
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows, hasLength(1));
    expect(rows.single.exitReason, 'pickforge_quit');
  });

  test('prune keeps last N per project', () async {
    for (var i = 0; i < 5; i++) {
      await db.runSessionLogDao.recordStart(
        sessionId: 'ses-$i',
        projectRoot: '/tmp/p',
        startedAt: DateTime.utc(2026, 4, i + 1),
        connectionMode: 'auto',
      );
    }
    await db.runSessionLogDao.pruneToCap('/tmp/p', cap: 3);
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows.map((r) => r.sessionId), ['ses-4', 'ses-3', 'ses-2']);
  });

  test('recentFor orders newest first', () async {
    await db.runSessionLogDao.recordStart(
      sessionId: 'old',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4),
      connectionMode: 'auto',
    );
    await db.runSessionLogDao.recordStart(
      sessionId: 'new',
      projectRoot: '/tmp/p',
      startedAt: DateTime.utc(2026, 4, 28),
      connectionMode: 'auto',
    );
    final rows = await db.runSessionLogDao.recentFor('/tmp/p');
    expect(rows.first.sessionId, 'new');
  });
}

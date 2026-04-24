import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';

void main() {
  late PickforgeDatabase db;

  setUp(() => db = PickforgeDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('upsert then load returns the latest settings', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/me/app',
      vmServiceUrl: 'ws://localhost:8181/ws',
      defaultAgentId: 'claude-code',
      defaultTerminalId: 'ghostty',
    );
    final loaded = await db.projectSettingsDao.loadFor('/me/app');
    expect(loaded?.vmServiceUrl, 'ws://localhost:8181/ws');
    expect(loaded?.defaultAgentId, 'claude-code');
  });

  test('upsert preserves settings not included in the update', () async {
    await db.projectSettingsDao.upsert(
      projectRoot: '/me/app',
      defaultAgentId: 'claude-code',
      defaultTerminalId: 'ghostty',
    );

    await db.projectSettingsDao.upsert(
      projectRoot: '/me/app',
      vmServiceUrl: 'ws://localhost:8181/ws',
    );

    final loaded = await db.projectSettingsDao.loadFor('/me/app');
    expect(loaded?.vmServiceUrl, 'ws://localhost:8181/ws');
    expect(loaded?.defaultAgentId, 'claude-code');
    expect(loaded?.defaultTerminalId, 'ghostty');
  });
}

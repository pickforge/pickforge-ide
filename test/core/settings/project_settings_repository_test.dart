import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/storage/context_storage_location.dart';

void main() {
  late PickforgeDatabase db;
  late ProjectSettingsRepository repo;

  setUp(() {
    db = PickforgeDatabase.forTesting(NativeDatabase.memory());
    repo = ProjectSettingsRepository(db);
  });
  tearDown(() => db.close());

  test('getVmServiceUrl returns null when unset', () async {
    expect(await repo.getVmServiceUrl('/me/app'), isNull);
  });

  test('setVmServiceUrl then getVmServiceUrl round-trips', () async {
    await repo.setVmServiceUrl('/me/app', 'ws://localhost:8181/ws');
    expect(await repo.getVmServiceUrl('/me/app'), 'ws://localhost:8181/ws');
  });

  test('setters preserve other saved settings', () async {
    await repo.setDefaultAgentId('/me/app', 'claude-code');
    await repo.setVmServiceUrl('/me/app', 'ws://localhost:8181/ws');

    expect(await repo.getVmServiceUrl('/me/app'), 'ws://localhost:8181/ws');
    expect(await repo.getDefaultAgentId('/me/app'), 'claude-code');
  });

  test('getContextStorageLocation is null when unset', () async {
    expect(await repo.getContextStorageLocation('/me/app'), isNull);
  });

  test('context storage location round-trips for each mode', () async {
    await repo.setContextStorageLocation(
      '/me/app',
      const ContextStorageLocation.pickforgeHome(),
    );
    expect(
      await repo.getContextStorageLocation('/me/app'),
      const ContextStorageLocation.pickforgeHome(),
    );

    await repo.setContextStorageLocation(
      '/me/app',
      const ContextStorageLocation.projectLocal(),
    );
    expect(
      await repo.getContextStorageLocation('/me/app'),
      const ContextStorageLocation.projectLocal(),
    );

    await repo.setContextStorageLocation(
      '/me/app',
      const ContextStorageLocation.custom('/data/pf'),
    );
    expect(
      await repo.getContextStorageLocation('/me/app'),
      const ContextStorageLocation.custom('/data/pf'),
    );
  });

  test('setting a null storage location clears the override', () async {
    await repo.setContextStorageLocation(
      '/me/app',
      const ContextStorageLocation.pickforgeHome(),
    );
    await repo.setContextStorageLocation('/me/app', null);
    expect(await repo.getContextStorageLocation('/me/app'), isNull);
  });

  test('storage location override preserves other settings', () async {
    await repo.setDefaultAgentId('/me/app', 'claude-code');
    await repo.setContextStorageLocation(
      '/me/app',
      const ContextStorageLocation.custom('/data/pf'),
    );
    expect(await repo.getDefaultAgentId('/me/app'), 'claude-code');
    expect(
      await repo.getContextStorageLocation('/me/app'),
      const ContextStorageLocation.custom('/data/pf'),
    );
  });
}

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';

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
}

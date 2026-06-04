import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('settings default to enabled and persist opt-out', () async {
    final repo = UpdateCheckSettingsRepository(
      await SharedPreferences.getInstance(),
    );

    expect((await repo.load()).enabled, isTrue);

    await repo.setEnabled(enabled: false);

    expect((await repo.load()).enabled, isFalse);
  });

  test('check returns notConfigured when no endpoint is provided', () async {
    final service = UpdateCheckService(
      settings: UpdateCheckSettingsRepository(
        await SharedPreferences.getInstance(),
      ),
      now: () => DateTime.utc(2026, 6, 4),
    );

    final result = await service.check();

    expect(result.status, UpdateCheckStatus.notConfigured);
    expect(result.currentVersion, '0.1.0+1');
    expect(result.checkedAt, DateTime.utc(2026, 6, 4));
  });

  test('check returns disabled without touching endpoint when opted out',
      () async {
    final repo = UpdateCheckSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repo.setEnabled(enabled: false);
    final service = UpdateCheckService(
      settings: repo,
      metadataUrl: 'http://127.0.0.1:9/update.json',
    );

    final result = await service.check();

    expect(result.status, UpdateCheckStatus.disabled);
  });

  test('check reports available update from metadata JSON', () async {
    final service = UpdateCheckService(
      settings: UpdateCheckSettingsRepository(
        await SharedPreferences.getInstance(),
      ),
      metadataFetcher: (_) async => {
        'version': '0.2.0+1',
        'downloadUrl': 'https://example.test/download',
        'releaseNotesUrl': 'https://example.test/releases/0.2.0',
      },
      metadataUrl: 'https://example.test/update.json',
    );

    final result = await service.check();

    expect(result.status, UpdateCheckStatus.updateAvailable);
    expect(result.hasUpdate, isTrue);
    expect(result.latestVersion, '0.2.0+1');
    expect(result.downloadUrl, 'https://example.test/download');
    expect(result.releaseNotesUrl, 'https://example.test/releases/0.2.0');
  });

  test('check reports up to date when latest version is not newer', () async {
    final service = UpdateCheckService(
      settings: UpdateCheckSettingsRepository(
        await SharedPreferences.getInstance(),
      ),
      metadataFetcher: (_) async => {'version': '0.1.0+1'},
      metadataUrl: 'https://example.test/update.json',
    );

    final result = await service.check();

    expect(result.status, UpdateCheckStatus.upToDate);
    expect(result.hasUpdate, isFalse);
  });

  test('check reports failed for malformed metadata', () async {
    final service = UpdateCheckService(
      settings: UpdateCheckSettingsRepository(
        await SharedPreferences.getInstance(),
      ),
      metadataFetcher: (_) async => <Object?>[],
      metadataUrl: 'https://example.test/update.json',
    );

    final result = await service.check();

    expect(result.status, UpdateCheckStatus.failed);
    expect(result.message, contains('Update metadata'));
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/notifications/notification_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('defaults to chat-ready sound enabled', () async {
    SharedPreferences.setMockInitialValues({});
    final repo =
        NotificationSettingsRepository(await SharedPreferences.getInstance());

    final settings = await repo.load();

    expect(settings.chatReadySoundEnabled, isTrue);
  });

  test('persists the toggle', () async {
    SharedPreferences.setMockInitialValues({});
    final repo =
        NotificationSettingsRepository(await SharedPreferences.getInstance());

    await repo.setChatReadySoundEnabled(enabled: false);

    expect((await repo.load()).chatReadySoundEnabled, isFalse);
  });
}

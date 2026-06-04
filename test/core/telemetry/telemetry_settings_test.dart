import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/telemetry/telemetry_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('defaults to disabled', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );

    expect((await repository.load()).enabled, isFalse);
  });

  test('persists explicit opt-in', () async {
    final repository = TelemetrySettingsRepository(
      await SharedPreferences.getInstance(),
    );

    await repository.setEnabled(enabled: true);

    expect((await repository.load()).enabled, isTrue);
  });
}

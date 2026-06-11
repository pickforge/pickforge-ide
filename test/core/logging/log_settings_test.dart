import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/logging/log_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('defaults to normal verbosity', () async {
    SharedPreferences.setMockInitialValues({});
    final repo = LogSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    expect(await repo.load(), LogVerbosity.normal);
  });

  test('round-trips verbosity', () async {
    SharedPreferences.setMockInitialValues({});
    final repo = LogSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    await repo.save(LogVerbosity.verbose);
    expect(await repo.load(), LogVerbosity.verbose);
  });

  test('falls back to normal on an unknown stored value', () async {
    SharedPreferences.setMockInitialValues({'logging.verbosity': 'wat'});
    final repo = LogSettingsRepository(
      await SharedPreferences.getInstance(),
    );
    expect(await repo.load(), LogVerbosity.normal);
  });
}

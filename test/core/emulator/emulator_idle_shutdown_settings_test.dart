import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/emulator/emulator_idle_shutdown_settings.dart';

void main() {
  test('defaults to disabled with confirmation required', () {
    const settings = EmulatorIdleShutdownSettings();

    expect(settings.enabled, isFalse);
    expect(settings.requireConfirmation, isTrue);
    expect(settings.isDefault, isTrue);
  });

  test('round-trips through JSON', () {
    const settings = EmulatorIdleShutdownSettings(
      enabled: true,
      requireConfirmation: false,
    );

    expect(
      EmulatorIdleShutdownSettings.fromJson(settings.toJson()),
      settings,
    );
  });

  test('copyWith resets confirmation when disabled', () {
    const settings = EmulatorIdleShutdownSettings(
      enabled: true,
      requireConfirmation: false,
    );

    expect(
      settings.copyWith(enabled: false),
      const EmulatorIdleShutdownSettings(),
    );
  });
}

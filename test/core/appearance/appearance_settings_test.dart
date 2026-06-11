import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/appearance/appearance_settings.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    // The palette is process-global; never leak light mode into other tests.
    PickforgeColors.palette = PickforgePalette.dark;
  });

  Future<AppearanceSettingsRepository> repo() async {
    final prefs = await SharedPreferences.getInstance();
    return AppearanceSettingsRepository(prefs);
  }

  test('defaults: dark, forge backdrop, animated', () async {
    SharedPreferences.setMockInitialValues({});
    expect((await repo()).load(), AppearanceSettings.defaults);
  });

  test('save/load round-trips every field', () async {
    SharedPreferences.setMockInitialValues({});
    final repository = await repo();
    const custom = AppearanceSettings(
      themeMode: AppearanceThemeMode.light,
      backdrop: WorkbenchBackdrop.plain,
      animatedBackdrop: false,
    );

    await repository.save(custom);

    expect(repository.load(), custom);
  });

  test('controller swaps the global palette before notifying', () async {
    SharedPreferences.setMockInitialValues({});
    final controller = AppearanceController(await repo());
    addTearDown(controller.dispose);

    PickforgePalette? paletteWhenNotified;
    controller.addListener(() => paletteWhenNotified = PickforgeColors.palette);

    await controller.update(
      AppearanceSettings.defaults.copyWith(
        themeMode: AppearanceThemeMode.light,
      ),
    );

    expect(paletteWhenNotified, same(PickforgePalette.light));
    expect(controller.themeMode, ThemeMode.light);
    expect(PickforgeColors.ember, PickforgePalette.light.ember);

    await controller.update(
      controller.value.copyWith(themeMode: AppearanceThemeMode.dark),
    );

    expect(PickforgeColors.palette, same(PickforgePalette.dark));
  });

  test('init applies persisted settings', () async {
    SharedPreferences.setMockInitialValues({
      'appearance.themeMode': 'light',
      'appearance.backdrop': 'plain',
      'appearance.animatedBackdrop': false,
    });
    final controller = AppearanceController(await repo());
    addTearDown(controller.dispose);

    controller.init();

    expect(controller.value.themeMode, AppearanceThemeMode.light);
    expect(controller.value.backdrop, WorkbenchBackdrop.plain);
    expect(controller.value.animatedBackdrop, isFalse);
    expect(PickforgeColors.palette, same(PickforgePalette.light));
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/appearance/appearance_settings.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/shared/components/forge_background.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const glow = Key('forge-backdrop-glow');
  const embers = Key('forge-backdrop-embers');

  setUp(() async {
    await getIt.reset();
  });

  tearDown(() async {
    await getIt.reset();
    PickforgeColors.palette = PickforgePalette.dark;
  });

  Future<AppearanceController> registerController(
    AppearanceSettings settings,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final controller =
        AppearanceController(AppearanceSettingsRepository(prefs));
    await controller.update(settings);
    getIt.registerSingleton<AppearanceController>(controller);
    addTearDown(controller.dispose);
    return controller;
  }

  Future<void> pump(WidgetTester tester, {bool reduceMotion = false}) {
    return tester.pumpWidget(
      MaterialApp(
        theme: PickforgeTheme.dark(),
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: reduceMotion),
          child: const ForgeBackground(child: SizedBox.expand()),
        ),
      ),
    );
  }

  testWidgets('without DI renders the static glow only', (tester) async {
    await pump(tester);

    expect(find.byKey(glow), findsOneWidget);
    expect(find.byKey(embers), findsNothing);
  });

  testWidgets('forge + animated renders glow and drifting embers',
      (tester) async {
    await registerController(AppearanceSettings.defaults);
    await pump(tester);

    expect(find.byKey(glow), findsOneWidget);
    expect(find.byKey(embers), findsOneWidget);
  });

  testWidgets('animations off keeps the glow, drops the embers',
      (tester) async {
    await registerController(
      AppearanceSettings.defaults.copyWith(animatedBackdrop: false),
    );
    await pump(tester);

    expect(find.byKey(glow), findsOneWidget);
    expect(find.byKey(embers), findsNothing);
  });

  testWidgets('reduce-motion overrides the animated setting', (tester) async {
    await registerController(AppearanceSettings.defaults);
    await pump(tester, reduceMotion: true);

    expect(find.byKey(glow), findsOneWidget);
    expect(find.byKey(embers), findsNothing);
  });

  testWidgets('plain backdrop paints the bare surface', (tester) async {
    await registerController(
      AppearanceSettings.defaults.copyWith(backdrop: WorkbenchBackdrop.plain),
    );
    await pump(tester);

    expect(find.byKey(glow), findsNothing);
    expect(find.byKey(embers), findsNothing);
  });

  testWidgets('toggling the setting live swaps the backdrop', (tester) async {
    final controller = await registerController(AppearanceSettings.defaults);
    await pump(tester);
    expect(find.byKey(embers), findsOneWidget);

    await controller.update(
      controller.value.copyWith(backdrop: WorkbenchBackdrop.plain),
    );
    await tester.pump();

    expect(find.byKey(glow), findsNothing);
    expect(find.byKey(embers), findsNothing);
  });
}

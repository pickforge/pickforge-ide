import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MockProjectsRepository extends Mock implements ProjectsRepository {}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    return getIt.reset();
  });

  testWidgets('router has workbench, onboarding, and settings routes',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final projects = _MockProjectsRepository();
    when(projects.list).thenAnswer((_) async => []);
    getIt.registerSingleton<ProjectsRepository>(projects);
    final router = buildAppRouter()..go(AppRoutes.onboarding);
    addTearDown(router.dispose);
    addTearDown(getIt.reset);
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(OnboardingView), findsOneWidget);
  });

  testWidgets('routes are wrapped with command palette navigation',
      (tester) async {
    tester.view.physicalSize = const Size(1400, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final projects = _MockProjectsRepository();
    when(projects.list).thenAnswer((_) async => []);
    getIt.registerSingleton<ProjectsRepository>(projects);
    final router = buildAppRouter()..go(AppRoutes.onboarding);
    addTearDown(router.dispose);
    addTearDown(getIt.reset);
    await tester.pumpWidget(
      MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(find.text('Go to Workbench'), findsOneWidget);
    expect(find.text('Go to Settings'), findsOneWidget);
  });
}

import 'package:go_router/go_router.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';

class AppRoutes {
  const AppRoutes._();
  static const root = '/';
  static const workbench = '/workbench';
  static const onboarding = '/onboarding';
  static const settings = '/settings';
}

GoRouter buildAppRouter() {
  return GoRouter(
    initialLocation: AppRoutes.root,
    redirect: (context, state) async {
      if (state.matchedLocation != AppRoutes.root) return null;
      final projects = await getIt<ProjectsRepository>().list();
      if (projects.isEmpty) return AppRoutes.onboarding;
      return AppRoutes.workbench;
    },
    routes: [
      GoRoute(
        path: AppRoutes.root,
        builder: (_, __) => const AppShellView(),
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (_, __) => const OnboardingView(),
      ),
      GoRoute(
        path: AppRoutes.workbench,
        builder: (_, __) => const AppShellView(),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (_, __) => const SettingsView(),
      ),
    ],
  );
}

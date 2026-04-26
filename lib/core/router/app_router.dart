import 'package:go_router/go_router.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
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
      final cubit = getIt<ProjectsCubit>();
      if (cubit.state is! ProjectsReady) await cubit.load();
      final ready = cubit.state;
      if (ready is ProjectsReady && ready.projects.isEmpty) {
        return AppRoutes.onboarding;
      }
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

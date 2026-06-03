import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/projects/projects_repository.dart';
import 'package:pickforge/core/settings/onboarding_preferences.dart';
import 'package:pickforge/features/history/view/history_view.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/workbench/view/app_shell_view.dart';
import 'package:pickforge/features/workbench/view/demo_workspace_view.dart';
import 'package:pickforge/features/workbench/view/onboarding_view.dart';
import 'package:pickforge/shared/command_palette/command_palette_scope.dart';

class AppRoutes {
  const AppRoutes._();
  static const root = '/';
  static const workbench = '/workbench';
  static const onboarding = '/onboarding';
  static const demo = '/demo';
  static const history = '/history';
  static const settings = '/settings';
}

GoRouter buildAppRouter({String? initialLocation}) {
  return GoRouter(
    initialLocation: initialLocation ?? _initialLocationFromEnvironment(),
    redirect: (context, state) async {
      if (state.matchedLocation != AppRoutes.root) return null;
      final projects = await getIt<ProjectsRepository>().list();
      if (projects.isEmpty) {
        if (getIt<OnboardingPreferences>().isDismissed) {
          return AppRoutes.workbench;
        }
        return AppRoutes.onboarding;
      }
      return AppRoutes.workbench;
    },
    routes: [
      GoRoute(
        path: AppRoutes.root,
        builder: (context, __) => _withCommandPalette(
          context,
          const AppShellView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (context, __) => _withCommandPalette(
          context,
          const OnboardingView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.workbench,
        builder: (context, __) => _withCommandPalette(
          context,
          const AppShellView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.demo,
        builder: (context, __) => _withCommandPalette(
          context,
          const DemoWorkspaceView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.history,
        builder: (context, __) => _withCommandPalette(
          context,
          const HistoryView(),
        ),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (context, __) => _withCommandPalette(
          context,
          const SettingsView(),
        ),
      ),
    ],
  );
}

String _initialLocationFromEnvironment() {
  return const String.fromEnvironment(
    'PICKFORGE_INITIAL_ROUTE',
    defaultValue: AppRoutes.root,
  );
}

Widget _withCommandPalette(BuildContext context, Widget child) {
  return CommandPaletteScope(
    commands: buildNavCommands(context),
    child: child,
  );
}

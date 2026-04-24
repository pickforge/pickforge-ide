import 'package:go_router/go_router.dart';
import 'package:pickforge/features/connection/view/connection_view.dart';
import 'package:pickforge/features/history/view/history_view.dart';
import 'package:pickforge/features/settings/view/settings_view.dart';
import 'package:pickforge/features/widget_picker/view/dock_view.dart';
import 'package:pickforge/shared/widgets/app_shell.dart';

/// Top-level routes. Features add their pages here as they come online.
class AppRoutes {
  const AppRoutes._();
  static const connect = '/connect';
  static const dock = '/';
  static const history = '/history';
  static const settings = '/settings';
}

GoRouter buildAppRouter() {
  return GoRouter(
    initialLocation: AppRoutes.connect,
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: AppRoutes.connect,
            builder: (_, __) => const ConnectionView(),
          ),
          GoRoute(
            path: AppRoutes.dock,
            builder: (_, __) => const DockView(),
          ),
          GoRoute(
            path: AppRoutes.history,
            builder: (_, __) => const HistoryView(),
          ),
          GoRoute(
            path: AppRoutes.settings,
            builder: (_, __) => const SettingsView(),
          ),
        ],
      ),
    ],
  );
}

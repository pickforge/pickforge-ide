import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/features/connection/view/connection_view.dart';
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
            builder: (_, __) => const _PlaceholderPage(title: 'Dock'),
          ),
          GoRoute(
            path: AppRoutes.history,
            builder: (_, __) => const _PlaceholderPage(title: 'History'),
          ),
          GoRoute(
            path: AppRoutes.settings,
            builder: (_, __) => const _PlaceholderPage(title: 'Settings'),
          ),
        ],
      ),
    ],
  );
}

class _PlaceholderPage extends StatelessWidget {
  const _PlaceholderPage({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(child: Text(title)),
    );
  }
}

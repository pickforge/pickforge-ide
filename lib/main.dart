import 'package:flutter/material.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/window/window_bootstrap.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await bootstrapWindow();
  await configureDependencies();
  runApp(const PickforgeApp());
}

class PickforgeApp extends StatelessWidget {
  const PickforgeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Pickforge',
      theme: PickforgeTheme.light(),
      darkTheme: PickforgeTheme.dark(),
      themeMode: ThemeMode.dark,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: buildAppRouter(),
    );
  }
}

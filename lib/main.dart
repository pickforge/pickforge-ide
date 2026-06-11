import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/appearance/appearance_settings.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/logging/app_logging.dart';
import 'package:pickforge/core/logging/log_settings.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/telemetry/crash_report_service.dart';
import 'package:pickforge/core/update/update_check_service.dart';
import 'package:pickforge/core/window/window_bootstrap.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureDependencies();
  if (getIt.isRegistered<AppLogging>()) {
    final logging = getIt<AppLogging>();
    await logging.start(
      verbosity: await getIt<LogSettingsRepository>().load(),
    );
    // Before the assertion guard: later-installed handlers run first, so
    // the guard filters its known-noise assertion before anything is
    // logged.
    logging.installErrorHooks();
  }
  await getIt<CrashReportService>().run(
    appRunner: () async {
      _installHardwareKeyboardAssertionGuard();
      await bootstrapWindow();
      runApp(const PickforgeApp());
      unawaited(_startUpdateCheck());
    },
  );
}

// Swallow upstream Flutter assertion when a synthesized modifier KeyUpEvent
// arrives for a key the framework never saw pressed (focus regained while
// modifier was held). See flutter/flutter#136419.
void _installHardwareKeyboardAssertionGuard() {
  final previousFlutter = FlutterError.onError;
  final previousPlatform = PlatformDispatcher.instance.onError;
  FlutterError.onError = (details) {
    if (_isPressedKeysAssertion(details.exception)) return;
    (previousFlutter ?? FlutterError.presentError)(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    if (_isPressedKeysAssertion(error)) return true;
    if (previousPlatform?.call(error, stack) ?? false) return true;
    // Forward to Flutter's normal error pipeline so async errors are visible.
    FlutterError.reportError(
      FlutterErrorDetails(exception: error, stack: stack),
    );
    return true;
  };
}

bool _isPressedKeysAssertion(Object error) {
  return error is AssertionError &&
      (error.message?.toString().contains('_pressedKeys.containsKey') ?? false);
}

Future<void> _startUpdateCheck() async {
  try {
    if (!getIt.isRegistered<UpdateCheckService>()) return;
    await getIt<UpdateCheckService>().checkInBackground();
  } on Object {
    return;
  }
}

class PickforgeApp extends StatefulWidget {
  const PickforgeApp({super.key});

  @override
  State<PickforgeApp> createState() => _PickforgeAppState();
}

class _PickforgeAppState extends State<PickforgeApp>
    with WidgetsBindingObserver {
  late final AppearanceController _appearance = getIt<AppearanceController>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    _appearance.onPlatformBrightnessChanged();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Last chance to land buffered log lines before the process dies.
    if (state == AppLifecycleState.detached &&
        getIt.isRegistered<AppLogging>()) {
      unawaited(getIt<AppLogging>().flush());
    }
  }

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<WorkbenchLayoutCubit>(
          create: (_) => getIt<WorkbenchLayoutCubit>(),
        ),
        BlocProvider<ProjectsCubit>(
          create: (_) {
            final cubit = getIt<ProjectsCubit>();
            unawaited(cubit.load());
            return cubit;
          },
        ),
        BlocProvider<ChatsCubit>(
          create: (_) => getIt<ChatsCubit>(),
        ),
      ],
      child: BlocListener<ProjectsCubit, ProjectsState>(
        listenWhen: shouldSyncChatsForProjects,
        listener: (context, state) {
          if (state is! ProjectsReady) return;
          unawaited(
            context.read<ChatsCubit>().syncProjects(
                  state.projects.map((p) => p.projectRoot).toList(),
                  defaultExpand: state.activeProjectRoot,
                ),
          );
        },
        child: ValueListenableBuilder<AppearanceSettings>(
          valueListenable: _appearance,
          builder: (context, appearance, _) => MaterialApp.router(
            title: 'PickForge',
            debugShowCheckedModeBanner: false,
            theme: PickforgeTheme.light(),
            darkTheme: PickforgeTheme.dark(),
            themeMode: _appearance.themeMode,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: buildAppRouter(),
          ),
        ),
      ),
    );
  }
}

bool shouldSyncChatsForProjects(ProjectsState previous, ProjectsState current) {
  if (current is! ProjectsReady) return false;
  if (previous is! ProjectsReady) return true;

  final previousRoots = previous.projects.map((p) => p.projectRoot).toList();
  final currentRoots = current.projects.map((p) => p.projectRoot).toList();
  return !listEquals(previousRoots, currentRoots);
}

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/core/window/window_bootstrap.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  _installHardwareKeyboardAssertionGuard();
  await bootstrapWindow();
  await configureDependencies();
  runApp(const PickforgeApp());
}

// Swallow upstream Flutter assertion when a synthesized modifier KeyUpEvent
// arrives for a key the framework never saw pressed (focus regained while
// modifier was held). See flutter/flutter#136419.
void _installHardwareKeyboardAssertionGuard() {
  final previousFlutter = FlutterError.onError;
  FlutterError.onError = (details) {
    if (_isPressedKeysAssertion(details.exception)) return;
    (previousFlutter ?? FlutterError.presentError)(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    if (_isPressedKeysAssertion(error)) return true;
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

class PickforgeApp extends StatelessWidget {
  const PickforgeApp({super.key});

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
        child: MaterialApp.router(
          title: 'Pickforge',
          theme: PickforgeTheme.light(),
          darkTheme: PickforgeTheme.dark(),
          themeMode: ThemeMode.dark,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: buildAppRouter(),
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

import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/workbench/cubit/chats_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette_scope.dart';

class WorkbenchCommandPaletteScope extends StatelessWidget {
  const WorkbenchCommandPaletteScope({
    required this.child,
    this.pickFolder = getDirectoryPath,
    this.onFocusExplorer,
    this.onFocusTerminal,
    super.key,
  });

  final Widget child;
  final Future<String?> Function() pickFolder;
  final VoidCallback? onFocusExplorer;
  final VoidCallback? onFocusTerminal;

  @override
  Widget build(BuildContext context) {
    final commands = buildWorkbenchCommands(context, pickFolder: pickFolder);
    return CallbackShortcuts(
      bindings: buildWorkbenchShortcutBindings(
        commands,
        onFocusExplorer: onFocusExplorer,
        onFocusTerminal: onFocusTerminal,
      ),
      child: CommandPaletteScope(
        commands: commands,
        child: child,
      ),
    );
  }
}

@visibleForTesting
Map<ShortcutActivator, VoidCallback> buildWorkbenchShortcutBindings(
  List<PickforgeCommand> commands, {
  VoidCallback? onFocusExplorer,
  VoidCallback? onFocusTerminal,
}) {
  final byId = {for (final command in commands) command.id: command};
  final bindings = <ShortcutActivator, VoidCallback>{};

  void bindPlatform(String id, LogicalKeyboardKey key) {
    final command = byId[id];
    if (command == null) return;
    bindings[SingleActivator(key, control: true)] = command.run;
    bindings[SingleActivator(key, meta: true)] = command.run;
  }

  bindPlatform('quick-add-project', LogicalKeyboardKey.keyO);
  bindPlatform('quick-new-chat', LogicalKeyboardKey.keyN);
  bindPlatform('quick-hot-reload', LogicalKeyboardKey.keyR);
  if (onFocusExplorer != null) {
    bindings[const SingleActivator(
      LogicalKeyboardKey.keyE,
      control: true,
      shift: true,
    )] = onFocusExplorer;
    bindings[const SingleActivator(
      LogicalKeyboardKey.keyE,
      meta: true,
      shift: true,
    )] = onFocusExplorer;
  }
  if (onFocusTerminal != null) {
    bindings[const SingleActivator(
      LogicalKeyboardKey.backquote,
      control: true,
    )] = onFocusTerminal;
    bindings[const SingleActivator(
      LogicalKeyboardKey.backquote,
      meta: true,
    )] = onFocusTerminal;
  }

  final runOrReload = byId['quick-run-app'] ?? byId['quick-hot-reload'];
  if (runOrReload != null) {
    bindings[const SingleActivator(LogicalKeyboardKey.f5)] = runOrReload.run;
  }

  return bindings;
}

@visibleForTesting
List<PickforgeCommand> buildWorkbenchCommands(
  BuildContext context, {
  Future<String?> Function() pickFolder = getDirectoryPath,
}) {
  final projectsState = context.watch<ProjectsCubit>().state;
  final activeProjectRoot = switch (projectsState) {
    ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
    _ => null,
  };

  EmulatorSessionCubit? emulatorCubit;
  EmulatorSessionState? emulatorState;
  try {
    emulatorCubit = context.watch<EmulatorSessionCubit>();
    emulatorState = emulatorCubit.state;
  } on ProviderNotFoundException {
    emulatorCubit = null;
    emulatorState = null;
  }

  final runAppCubit = switch (emulatorState) {
    Idle(:final shutdownPrompt) when !shutdownPrompt => emulatorCubit,
    _ => null,
  };
  final hotReloadCubit = switch (emulatorState) {
    Running(:final recovered) when !recovered => emulatorCubit,
    _ => null,
  };

  return [
    ...buildNavCommands(context),
    PickforgeCommand(
      id: 'quick-add-project',
      title: 'Add Project',
      hint: 'Pick a project folder',
      run: () => unawaited(_addProject(context, pickFolder)),
    ),
    if (activeProjectRoot != null)
      PickforgeCommand(
        id: 'quick-new-chat',
        title: 'New Chat',
        hint: 'Create a chat for the active project',
        run: () => unawaited(_newChat(context, activeProjectRoot)),
      ),
    if (runAppCubit != null)
      PickforgeCommand(
        id: 'quick-run-app',
        title: 'Run App',
        hint: 'Start Flutter on the selected device',
        run: () => unawaited(runAppCubit.runApp()),
      ),
    if (hotReloadCubit != null)
      PickforgeCommand(
        id: 'quick-hot-reload',
        title: 'Hot Reload',
        hint: 'Reload the active Flutter run',
        run: () => unawaited(hotReloadCubit.hotReload()),
      ),
    PickforgeCommand(
      id: 'quick-pick-device',
      title: 'Pick Device',
      hint: 'Open device run settings',
      run: () => context.go(AppRoutes.settings),
    ),
    PickforgeCommand(
      id: 'quick-open-settings',
      title: 'Open Settings',
      hint: 'App and project settings',
      run: () => context.go(AppRoutes.settings),
    ),
  ];
}

Future<void> _addProject(
  BuildContext context,
  Future<String?> Function() pickFolder,
) async {
  final picked = await pickFolder();
  if (picked == null || !context.mounted) return;
  await context.read<ProjectsCubit>().add(picked);
}

Future<void> _newChat(BuildContext context, String projectRoot) async {
  await context.read<ChatsCubit>().newChat(
        projectRoot: projectRoot,
        defaultAgentId: 'claude-code',
      );
}

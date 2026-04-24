import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/shared/command_palette/command.dart';
import 'package:pickforge/shared/command_palette/command_palette.dart';

/// Wraps [child] with [CallbackShortcuts] for ⌘K / Ctrl+K.
/// Opens the [CommandPalette] dialog with the provided commands.
class CommandPaletteScope extends StatelessWidget {
  const CommandPaletteScope({
    required this.commands,
    required this.child,
    super.key,
  });

  final List<PickforgeCommand> commands;
  final Widget child;

  Future<void> _openPalette(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (_) => CommandPalette(commands: commands),
    );
  }

  @override
  Widget build(BuildContext context) {
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.keyK, meta: true): () =>
            _openPalette(context),
        const SingleActivator(LogicalKeyboardKey.keyK, control: true): () =>
            _openPalette(context),
      },
      child: Focus(
        autofocus: true,
        child: child,
      ),
    );
  }
}

/// Default navigation commands for the app shell.
List<PickforgeCommand> buildNavCommands(BuildContext context) {
  return [
    PickforgeCommand(
      id: 'nav-dock',
      title: 'Go to Dock',
      hint: 'Widget picker',
      run: () => context.go(AppRoutes.dock),
    ),
    PickforgeCommand(
      id: 'nav-connect',
      title: 'Go to Connect',
      hint: 'VM Service connection',
      run: () => context.go(AppRoutes.connect),
    ),
    PickforgeCommand(
      id: 'nav-history',
      title: 'Go to History',
      hint: 'Pick history',
      run: () => context.go(AppRoutes.history),
    ),
    PickforgeCommand(
      id: 'nav-settings',
      title: 'Go to Settings',
      hint: 'App settings',
      run: () => context.go(AppRoutes.settings),
    ),
  ];
}

import 'package:flutter/material.dart';
import 'package:pickforge/shared/command_palette/command_palette_scope.dart';

/// Wraps every route with the Pickforge chrome.
/// Provides command palette (⌘K / Ctrl+K) around the child.
class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CommandPaletteScope(
      commands: buildNavCommands(context),
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        child: child,
      ),
    );
  }
}

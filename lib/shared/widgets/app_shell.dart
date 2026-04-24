import 'package:flutter/material.dart';

/// Wraps every route with the Pickforge chrome. MVP version: plain container.
/// Command palette, tab bar, toasts land here in Task 41.
class AppShell extends StatelessWidget {
  const AppShell({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: child,
    );
  }
}

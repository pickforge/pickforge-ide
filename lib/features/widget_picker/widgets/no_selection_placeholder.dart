import 'package:flutter/material.dart';

class NoSelectionPlaceholder extends StatelessWidget {
  const NoSelectionPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('Tap a widget in the emulator to pick it'),
    );
  }
}

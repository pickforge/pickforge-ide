import 'package:flutter/material.dart';

class ChatWorkbenchPanel extends StatelessWidget {
  const ChatWorkbenchPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surface,
      child: const SizedBox.expand(),
    );
  }
}

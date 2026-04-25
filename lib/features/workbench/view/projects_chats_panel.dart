import 'package:flutter/material.dart';

class ProjectsChatsPanel extends StatelessWidget {
  const ProjectsChatsPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: const SizedBox.expand(),
    );
  }
}

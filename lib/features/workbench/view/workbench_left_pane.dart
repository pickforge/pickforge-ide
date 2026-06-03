import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';

class WorkbenchLeftPane extends StatelessWidget {
  const WorkbenchLeftPane({super.key});

  @override
  Widget build(BuildContext context) {
    final hasActiveProject = context.select<ProjectsCubit, bool>((cubit) {
      final state = cubit.state;
      return state is ProjectsReady && state.activeProjectRoot != null;
    });
    return Column(
      children: [
        const Expanded(
          flex: 3,
          child: ProjectsChatsPanel(),
        ),
        if (hasActiveProject) ...[
          const Divider(height: 1),
          const Expanded(
            flex: 2,
            child: SingleChildScrollView(
              child: ProjectFileExplorerPanel(),
            ),
          ),
        ],
      ],
    );
  }
}

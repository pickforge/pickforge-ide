import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';

class AppShellView extends StatelessWidget {
  const AppShellView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkbenchLayoutCubit, WorkbenchLayoutState>(
      builder: (context, layout) {
        final controller = MultiSplitViewController(
          areas: [
            Area(
              size: layout.leftWidth,
              min: 180,
              max: 360,
              builder: (_, __) =>
                  const ProjectsChatsPanel(key: Key('workbench-left')),
            ),
            Area(
              min: 320,
              builder: (_, __) =>
                  const ChatWorkbenchPanel(key: Key('workbench-middle')),
            ),
            if (!layout.rightCollapsed)
              Area(
                size: layout.rightWidth,
                min: 240,
                max: 480,
                builder: (_, __) =>
                    const InspectorPanel(key: Key('workbench-right')),
              ),
          ],
        );
        return Scaffold(
          body: MultiSplitView(
            controller: controller,
            onDividerDragEnd: (_) {
              final left = controller.getArea(0).size ?? layout.leftWidth;
              final right = controller.areasCount > 2
                  ? (controller.getArea(2).size ?? layout.rightWidth)
                  : layout.rightWidth;
              context
                  .read<WorkbenchLayoutCubit>()
                  .updateSizes(left: left, right: right);
            },
          ),
        );
      },
    );
  }
}

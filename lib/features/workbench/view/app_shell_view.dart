import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

class AppShellView extends StatelessWidget {
  const AppShellView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<WorkbenchLayoutCubit, WorkbenchLayoutState>(
      builder: (context, layout) {
        final reduce = ReduceMotion.of(context);
        Widget animated(Widget child, {required Duration delay}) {
          if (reduce) return child;
          return child.animate().fadeIn(
                duration: 240.ms,
                delay: delay,
                curve: Curves.easeOutCubic,
              );
        }

        final controller = MultiSplitViewController(
          areas: [
            Area(
              size: layout.leftWidth,
              min: 180,
              max: 360,
              builder: (_, __) => animated(
                const ProjectsChatsPanel(key: Key('workbench-left')),
                delay: Duration.zero,
              ),
            ),
            Area(
              min: 320,
              builder: (_, __) => animated(
                const ChatWorkbenchPanel(key: Key('workbench-middle')),
                delay: 60.ms,
              ),
            ),
            if (!layout.rightCollapsed)
              Area(
                size: layout.rightWidth,
                min: 240,
                max: 480,
                builder: (_, __) => animated(
                  const InspectorPanel(key: Key('workbench-right')),
                  delay: 120.ms,
                ),
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

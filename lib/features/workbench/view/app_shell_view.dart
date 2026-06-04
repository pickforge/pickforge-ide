import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:multi_split_view/multi_split_view.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/drift/pickforge_database.dart';
import 'package:pickforge/core/emulator/avd_launcher.dart';
import 'package:pickforge/core/emulator/avd_shutdown_controller.dart';
import 'package:pickforge/core/emulator/boot_readiness_poller.dart';
import 'package:pickforge/core/emulator/device_discovery_service.dart';
import 'package:pickforge/core/emulator/emulator_ipc_server.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/emulator/run_session_controller.dart';
import 'package:pickforge/core/emulator/run_session_log_repository.dart';
import 'package:pickforge/core/emulator/run_session_recovery_store.dart';
import 'package:pickforge/core/inspector/adb_screenshot_capturer.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_file_tree_scanner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/vm_service/vm_service_client.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_cubit.dart';
import 'package:pickforge/features/widget_picker/widget_picker.dart';
import 'package:pickforge/features/workbench/cubit/project_file_explorer_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_state.dart';
import 'package:pickforge/features/workbench/cubit/workspace_sidebar_cubit.dart';
import 'package:pickforge/features/workbench/view/chat_workbench_panel.dart';
import 'package:pickforge/features/workbench/view/inspector_panel.dart';
import 'package:pickforge/features/workbench/view/workbench_command_palette_scope.dart';
import 'package:pickforge/features/workbench/view/workbench_left_pane.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

class AppShellView extends StatefulWidget {
  const AppShellView({super.key});

  @override
  State<AppShellView> createState() => _AppShellViewState();
}

class _AppShellViewState extends State<AppShellView> {
  late final MultiSplitViewController _controller;

  bool _hasRight = false;

  @override
  void initState() {
    super.initState();
    _controller = MultiSplitViewController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider<WorkspaceSidebarCubit>(
      create: (_) {
        final cubit = getIt<WorkspaceSidebarCubit>();
        unawaited(cubit.load());
        return cubit;
      },
      child: BlocBuilder<WorkbenchLayoutCubit, WorkbenchLayoutState>(
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

          _syncAreas(layout, animated);

          final scaffold = Scaffold(
            body: MultiSplitView(
              controller: _controller,
              onDividerDragEnd: (_) {
                final left = _controller.getArea(0).size ?? layout.leftWidth;
                final right = _controller.areasCount > 2
                    ? (_controller.getArea(2).size ?? layout.rightWidth)
                    : layout.rightWidth;
                context
                    .read<WorkbenchLayoutCubit>()
                    .updateSizes(left: left, right: right);
              },
            ),
          );
          return BlocBuilder<ProjectsCubit, ProjectsState>(
            buildWhen: (_, current) => current is ProjectsReady,
            builder: (context, projects) {
              final projectRoot = switch (projects) {
                ProjectsReady(:final activeProjectRoot) => activeProjectRoot,
                _ => null,
              };
              if (projectRoot == null) {
                return WorkbenchCommandPaletteScope(child: scaffold);
              }
              return MultiBlocProvider(
                key: ValueKey(projectRoot),
                providers: [
                  BlocProvider(create: (_) => RunLogsCubit()),
                  BlocProvider(
                    create: (_) => ContextAttachmentsCubit(
                      projectRoot: projectRoot,
                    ),
                  ),
                  BlocProvider<ProjectFileExplorerCubit>(
                    create: (_) {
                      final processRunner = getIt<ProcessRunner>();
                      final cubit = ProjectFileExplorerCubit(
                        projectRoot: projectRoot,
                        scanner: const ProjectFileTreeScanner(),
                        opener: ProjectFileOpener(runner: processRunner),
                      );
                      unawaited(cubit.load());
                      unawaited(cubit.watch());
                      return cubit;
                    },
                  ),
                  BlocProvider<EmulatorSessionCubit>(
                    create: (context) {
                      final cubit = EmulatorSessionCubit(
                        projectRoot: projectRoot,
                        settings: getIt<ProjectSettingsRepository>(),
                        discovery: getIt<DeviceDiscoveryService>(),
                        launcher: getIt<AvdLauncher>(),
                        poller: getIt<BootReadinessPoller>(),
                        runController: getIt<RunSessionController>(),
                        logRepo: getIt<RunSessionLogRepository>(),
                        vmClient: getIt<VmServiceClient>(),
                        logsCubit: context.read<RunLogsCubit>(),
                        ipcServer: getIt<EmulatorIpcServer>(),
                        pickHistoryDao:
                            getIt<PickforgeDatabase>().pickHistoryDao,
                        screenshotCapturer: getIt<AdbScreenshotCapturer>(),
                        recoveryStore: const RunSessionRecoveryStore(),
                        shutdownController: getIt<AvdShutdownController>(),
                      );
                      unawaited(cubit.bootstrap());
                      return cubit;
                    },
                  ),
                ],
                child: WidgetPickerScope(
                  projectRoot: projectRoot,
                  vmClient: getIt<VmServiceClient>(),
                  ipcServer: getIt<EmulatorIpcServer>(),
                  inspectorVisible: !layout.rightCollapsed,
                  child: WorkbenchCommandPaletteScope(child: scaffold),
                ),
              );
            },
          );
        },
      ),
    );
  }

  void _syncAreas(
    WorkbenchLayoutState layout,
    Widget Function(Widget, {required Duration delay}) animated,
  ) {
    final wantsRight = !layout.rightCollapsed;

    if (_controller.areasCount == 0 || wantsRight != _hasRight) {
      _recreateAreas(layout, animated);
      _hasRight = wantsRight;
      return;
    }

    _controller.getArea(0)
      ..size = layout.leftWidth
      ..min = 180
      ..max = 360
      ..builder = (_, __) => animated(
            const WorkbenchLeftPane(key: Key('workbench-left')),
            delay: Duration.zero,
          );

    _controller.getArea(1)
      ..min = 320
      ..builder = (_, __) => animated(
            const ChatWorkbenchPanel(key: Key('workbench-middle')),
            delay: 60.ms,
          );

    if (wantsRight) {
      _controller.getArea(2)
        ..size = layout.rightWidth
        ..min = 240
        ..max = 480
        ..builder = (_, __) => animated(
              const InspectorPanel(key: Key('workbench-right')),
              delay: 120.ms,
            );
    }
  }

  void _recreateAreas(
    WorkbenchLayoutState layout,
    Widget Function(Widget, {required Duration delay}) animated,
  ) {
    final areas = <Area>[
      Area(
        id: 'left',
        size: layout.leftWidth,
        min: 180,
        max: 360,
        builder: (_, __) => animated(
          const WorkbenchLeftPane(key: Key('workbench-left')),
          delay: Duration.zero,
        ),
      ),
      Area(
        id: 'middle',
        min: 320,
        builder: (_, __) => animated(
          const ChatWorkbenchPanel(key: Key('workbench-middle')),
          delay: 60.ms,
        ),
      ),
      if (!layout.rightCollapsed)
        Area(
          id: 'right',
          size: layout.rightWidth,
          min: 240,
          max: 480,
          builder: (_, __) => animated(
            const InspectorPanel(key: Key('workbench-right')),
            delay: 120.ms,
          ),
        ),
    ];
    _controller.areas = areas;
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/device_picker_menu.dart';
import 'package:pickforge/features/emulator/view/manual_url_form.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

class ConnectionPill extends StatelessWidget {
  const ConnectionPill({super.key});

  @override
  Widget build(BuildContext context) {
    try {
      context.read<EmulatorSessionCubit>();
    } on ProviderNotFoundException {
      return const _AnimatedPillContent(
        state: EmulatorSessionState.noDevicePicked(),
        cubit: null,
      );
    }
    return BlocBuilder<EmulatorSessionCubit, EmulatorSessionState>(
      builder: (context, state) {
        final cubit = context.read<EmulatorSessionCubit>();
        return _AnimatedPillContent(state: state, cubit: cubit);
      },
    );
  }
}

class _AnimatedPillContent extends StatelessWidget {
  const _AnimatedPillContent({required this.state, required this.cubit});

  final EmulatorSessionState state;
  final EmulatorSessionCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final duration = ReduceMotion.duration(
      context,
      const Duration(milliseconds: 180),
    );
    return AnimatedSwitcher(
      duration: duration,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SizeTransition(
          sizeFactor: animation,
          axis: Axis.horizontal,
          child: child,
        ),
      ),
      child: _PillContent(
        key: ValueKey<Object>(state.runtimeType),
        state: state,
        cubit: cubit,
      ),
    );
  }
}

class _PillContent extends StatelessWidget {
  const _PillContent({required this.state, required this.cubit, super.key});

  final EmulatorSessionState state;
  final EmulatorSessionCubit? cubit;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          _StatusDot(state: state),
          const SizedBox(width: 8),
          Expanded(child: Text(_label(state))),
          if (cubit != null) _PrimaryAction(state: state, cubit: cubit!),
          const SizedBox(width: 4),
          if (cubit != null) _Menu(state: state, cubit: cubit!),
        ],
      ),
    );
  }

  String _label(EmulatorSessionState state) => switch (state) {
        NoDevicePicked() => 'Pick device',
        Cold(:final avd) => avd.name,
        Booting(:final avd) => '${avd.name} booting...',
        Idle(:final avd, :final shutdownPrompt) =>
          shutdownPrompt ? 'Shutdown ${avd.name}?' : avd.name,
        RecoveryPending(:final avd, :final canAdopt) =>
          canAdopt ? 'Recover ${avd?.name ?? 'run'}' : 'Stale run',
        Running(:final manual, :final avd) =>
          manual ? 'Manual' : (avd?.name ?? 'Running'),
        Reconnecting(:final avd) => '${avd.name} reconnecting',
        EmulatorError(:final message) => 'Error $message',
      };
}

class _StatusDot extends StatefulWidget {
  const _StatusDot({required this.state});

  final EmulatorSessionState state;

  @override
  State<_StatusDot> createState() => _StatusDotState();
}

class _StatusDotState extends State<_StatusDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _scale;
  DateTime? _lastReloadAt;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _scale = Tween<double>(begin: 1, end: 1.4).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncAnimation();
  }

  @override
  void didUpdateWidget(covariant _StatusDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    final reloadAt = _reloadAt(widget.state);
    if (oldWidget.state.runtimeType != widget.state.runtimeType ||
        reloadAt != _lastReloadAt) {
      _syncAnimation();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _syncAnimation() {
    if (!mounted) return;
    _lastReloadAt = _reloadAt(widget.state);
    if (ReduceMotion.of(context)) {
      _controller
        ..stop()
        ..value = 0;
      return;
    }
    switch (widget.state) {
      case Booting():
        _controller
          ..duration = const Duration(milliseconds: 700)
          ..repeat(reverse: true).ignore();
      case Reconnecting():
        _controller
          ..duration = const Duration(milliseconds: 1500)
          ..repeat().ignore();
      case Running(:final lastReloadAt) when lastReloadAt != null:
        _controller
          ..duration = const Duration(milliseconds: 200)
          ..forward(from: 0).ignore();
      default:
        _controller.stop();
        _controller.value = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    const dot = Icon(Icons.circle, size: 10);
    if (ReduceMotion.of(context)) return dot;
    return switch (widget.state) {
      Booting() => ScaleTransition(scale: _scale, child: dot),
      Running(:final lastReloadAt) when lastReloadAt != null => ScaleTransition(
          key: const Key('reload-pulse-dot'),
          scale: _scale,
          child: dot,
        ),
      Reconnecting() => RotationTransition(turns: _controller, child: dot),
      _ => dot,
    };
  }

  DateTime? _reloadAt(EmulatorSessionState state) => switch (state) {
        Running(:final lastReloadAt) => lastReloadAt,
        _ => null,
      };
}

class _Menu extends StatelessWidget {
  const _Menu({required this.state, required this.cubit});

  final EmulatorSessionState state;
  final EmulatorSessionCubit cubit;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<_MenuAction>(
      key: const Key('pill-menu'),
      icon: const Icon(Icons.expand_more, size: 18),
      onSelected: (action) => _onSelected(context, action),
      itemBuilder: (context) => switch (state) {
        NoDevicePicked() => const [
            PopupMenuItem(
              value: _MenuAction.pickDevice,
              child: Text('Pick device...'),
            ),
            PopupMenuItem(
              value: _MenuAction.manualUrl,
              child: Text('Manual VM Service URL...'),
            ),
            PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
          ],
        Cold() => const [
            PopupMenuItem(
              value: _MenuAction.pickDevice,
              child: Text('Pick different...'),
            ),
            PopupMenuItem(
              value: _MenuAction.manualUrl,
              child: Text('Manual VM Service URL...'),
            ),
            PopupMenuItem(
              value: _MenuAction.forget,
              child: Text('Forget device'),
            ),
            PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
          ],
        Idle(:final shutdownPrompt) => [
            if (shutdownPrompt)
              const PopupMenuItem(
                value: _MenuAction.keepIdleAvd,
                child: Text('Keep running'),
              ),
            if (shutdownPrompt)
              const PopupMenuItem(
                value: _MenuAction.shutdownIdleAvd,
                child: Text('Shutdown emulator'),
              ),
            const PopupMenuItem(
              value: _MenuAction.pickDevice,
              child: Text('Pick different...'),
            ),
            const PopupMenuItem(
              value: _MenuAction.manualUrl,
              child: Text('Manual VM Service URL...'),
            ),
            const PopupMenuItem(
              value: _MenuAction.forget,
              child: Text('Forget device'),
            ),
            const PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
          ],
        Running(:final manual, :final recovered) => [
            if (!recovered)
              const PopupMenuItem(
                value: _MenuAction.hotRestart,
                child: Text('Hot restart'),
              ),
            PopupMenuItem(
              value: recovered
                  ? _MenuAction.cleanupRecoveredRun
                  : _MenuAction.stop,
              child: Text(recovered ? 'Clean up orphaned run' : 'Stop'),
            ),
            const PopupMenuItem(
              value: _MenuAction.viewLogs,
              child: Text('View logs'),
            ),
            const PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
            if (manual)
              const PopupMenuItem(
                value: _MenuAction.editUrl,
                child: Text('Edit URL...'),
              ),
          ],
        RecoveryPending(:final canAdopt) => [
            if (canAdopt)
              const PopupMenuItem(
                value: _MenuAction.adoptRecoveredRun,
                child: Text('Adopt recovered run'),
              ),
            const PopupMenuItem(
              value: _MenuAction.cleanupRecoveredRun,
              child: Text('Clean up orphaned run'),
            ),
            const PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
          ],
        Booting() || Reconnecting() => const [
            PopupMenuItem(
              value: _MenuAction.viewLogs,
              child: Text('View logs'),
            ),
            PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
          ],
        EmulatorError() => const [
            PopupMenuItem(
              value: _MenuAction.viewLogs,
              child: Text('View logs'),
            ),
            PopupMenuItem(
              value: _MenuAction.viewHistory,
              child: Text('View run history'),
            ),
            PopupMenuItem(
              value: _MenuAction.pickDevice,
              child: Text('Pick different...'),
            ),
            PopupMenuItem(
              value: _MenuAction.manualUrl,
              child: Text('Manual VM Service URL...'),
            ),
            PopupMenuItem(
              value: _MenuAction.forget,
              child: Text('Forget device'),
            ),
          ],
      },
    );
  }

  Future<void> _onSelected(BuildContext context, _MenuAction action) async {
    switch (action) {
      case _MenuAction.pickDevice:
        await _openPicker(context);
      case _MenuAction.manualUrl:
      case _MenuAction.editUrl:
        await _openManual(context);
      case _MenuAction.forget:
        await cubit.forgetDevice();
      case _MenuAction.hotRestart:
        await cubit.hotRestart();
      case _MenuAction.stop:
        await cubit.stopRun();
      case _MenuAction.adoptRecoveredRun:
        await cubit.adoptRecoveredRun();
      case _MenuAction.cleanupRecoveredRun:
        await cubit.cleanupRecoveredRun();
      case _MenuAction.shutdownIdleAvd:
        await cubit.confirmIdleShutdown();
      case _MenuAction.keepIdleAvd:
        cubit.dismissIdleShutdownPrompt();
      case _MenuAction.viewLogs:
        try {
          context.read<WorkbenchLayoutCubit>().toggleRunLogs();
        } on ProviderNotFoundException {
          break;
        }
      case _MenuAction.viewHistory:
        context.go(AppRoutes.runHistory);
    }
  }
}

enum _MenuAction {
  pickDevice,
  manualUrl,
  editUrl,
  forget,
  hotRestart,
  stop,
  adoptRecoveredRun,
  cleanupRecoveredRun,
  shutdownIdleAvd,
  keepIdleAvd,
  viewLogs,
  viewHistory
}

Future<void> _openPicker(BuildContext context) async {
  final session = context.read<EmulatorSessionCubit>();
  await showDialog<void>(
    context: context,
    builder: (_) => Dialog(
      child: MultiBlocProvider(
        providers: [
          BlocProvider.value(value: session),
          BlocProvider(create: (_) => getIt<DevicePickerCubit>()),
        ],
        child: const DevicePickerMenu(),
      ),
    ),
  );
}

Future<void> _openManual(BuildContext context) async {
  final session = context.read<EmulatorSessionCubit>();
  await showDialog<void>(
    context: context,
    builder: (_) => Dialog(
      child: BlocProvider.value(
        value: session,
        child: const ManualUrlForm(),
      ),
    ),
  );
}

class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.state, required this.cubit});

  final EmulatorSessionState state;
  final EmulatorSessionCubit cubit;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      NoDevicePicked() => const SizedBox.shrink(),
      Cold() => _PillActionButton(
          icon: Icons.play_arrow,
          label: 'Boot',
          onPressed: cubit.bootAvd,
          primary: true,
        ),
      Booting() => _PillActionButton(
          icon: Icons.close,
          label: 'Cancel',
          onPressed: cubit.cancelBoot,
        ),
      Idle(:final shutdownPrompt) => shutdownPrompt
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _PillActionButton(
                  icon: Icons.pause_circle_outline,
                  label: 'Keep',
                  onPressed: cubit.dismissIdleShutdownPrompt,
                ),
                const SizedBox(width: PickforgeSpacing.xs),
                _PillActionButton(
                  icon: Icons.power_settings_new,
                  label: 'Shutdown',
                  onPressed: cubit.confirmIdleShutdown,
                  danger: true,
                ),
              ],
            )
          : _PillActionButton(
              icon: Icons.terminal,
              label: 'Run app',
              onPressed: cubit.runApp,
              primary: true,
            ),
      RecoveryPending(:final canAdopt) => _PillActionButton(
          icon: canAdopt ? Icons.restore : Icons.cleaning_services,
          label: canAdopt ? 'Adopt' : 'Cleanup',
          onPressed:
              canAdopt ? cubit.adoptRecoveredRun : cubit.cleanupRecoveredRun,
        ),
      Running(:final recovered) => recovered
          ? _PillActionButton(
              icon: Icons.cleaning_services,
              label: 'Cleanup',
              onPressed: cubit.cleanupRecoveredRun,
            )
          : _PillActionButton(
              icon: Icons.refresh,
              label: 'Reload',
              onPressed: cubit.hotReload,
              primary: true,
            ),
      Reconnecting() => const SizedBox.shrink(),
      EmulatorError() => _PillActionButton(
          icon: Icons.refresh,
          label: 'Retry',
          onPressed: cubit.bootAvd,
        ),
    };
  }
}

class _PillActionButton extends StatelessWidget {
  const _PillActionButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.primary = false,
    this.danger = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final bool primary;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
    );
    final style = primary
        ? FilledButton.styleFrom(
            visualDensity: VisualDensity.compact,
            minimumSize: const Size(0, 30),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.sm,
              vertical: PickforgeSpacing.xs,
            ),
            shape: shape,
          )
        : OutlinedButton.styleFrom(
            visualDensity: VisualDensity.compact,
            minimumSize: const Size(0, 30),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.sm,
              vertical: PickforgeSpacing.xs,
            ),
            foregroundColor: danger ? colorScheme.error : null,
            shape: shape,
          );
    final child = Icon(icon, size: 15);
    if (primary) {
      return FilledButton.icon(
        style: style,
        onPressed: onPressed,
        icon: child,
        label: Text(label),
      );
    }
    return OutlinedButton.icon(
      style: style,
      onPressed: onPressed,
      icon: child,
      label: Text(label),
    );
  }
}

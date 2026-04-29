import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/features/emulator/cubit/device_picker_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/view/device_picker_menu.dart';
import 'package:pickforge/features/emulator/view/manual_url_form.dart';
import 'package:pickforge/features/workbench/cubit/workbench_layout_cubit.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

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
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 180),
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
        Idle(:final avd) => avd.name,
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
    switch (widget.state) {
      case Booting():
        _controller
          ..duration = const Duration(milliseconds: 700)
          ..repeat(reverse: true);
      case Reconnecting():
        _controller
          ..duration = const Duration(milliseconds: 1500)
          ..repeat();
      case Running(:final lastReloadAt) when lastReloadAt != null:
        _controller
          ..duration = const Duration(milliseconds: 200)
          ..forward(from: 0);
      default:
        _controller.stop();
        _controller.value = 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final dot = const Icon(Icons.circle, size: 10);
    if (ReduceMotion.of(context)) return dot;
    return switch (widget.state) {
      Booting() => ScaleTransition(scale: _scale, child: dot),
      Running(:final lastReloadAt) when lastReloadAt != null => ScaleTransition(
          key: const Key('reload-pulse-dot'), scale: _scale, child: dot),
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
                value: _MenuAction.pickDevice, child: Text('Pick device...')),
            PopupMenuItem(
                value: _MenuAction.manualUrl,
                child: Text('Manual VM Service URL...')),
          ],
        Cold() || Idle() => const [
            PopupMenuItem(
                value: _MenuAction.pickDevice,
                child: Text('Pick different...')),
            PopupMenuItem(
                value: _MenuAction.manualUrl,
                child: Text('Manual VM Service URL...')),
            PopupMenuItem(
                value: _MenuAction.forget, child: Text('Forget device')),
          ],
        Running(:final manual) => [
            const PopupMenuItem(
                value: _MenuAction.hotRestart, child: Text('Hot restart')),
            const PopupMenuItem(value: _MenuAction.stop, child: Text('Stop')),
            const PopupMenuItem(
                value: _MenuAction.viewLogs, child: Text('View logs')),
            if (manual)
              const PopupMenuItem(
                  value: _MenuAction.editUrl, child: Text('Edit URL...')),
          ],
        Booting() || Reconnecting() => const [
            PopupMenuItem(
                value: _MenuAction.viewLogs, child: Text('View logs')),
          ],
        EmulatorError() => const [
            PopupMenuItem(
                value: _MenuAction.viewLogs, child: Text('View logs')),
            PopupMenuItem(
                value: _MenuAction.pickDevice,
                child: Text('Pick different...')),
            PopupMenuItem(
                value: _MenuAction.manualUrl,
                child: Text('Manual VM Service URL...')),
            PopupMenuItem(
                value: _MenuAction.forget, child: Text('Forget device')),
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
      case _MenuAction.viewLogs:
        try {
          context.read<WorkbenchLayoutCubit>().toggleRunLogs();
        } on ProviderNotFoundException {
          break;
        }
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
  viewLogs
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
      Cold() => TextButton(onPressed: cubit.bootAvd, child: const Text('Boot')),
      Booting() =>
        TextButton(onPressed: cubit.cancelBoot, child: const Text('Cancel')),
      Idle() =>
        TextButton(onPressed: cubit.runApp, child: const Text('Run app')),
      Running() =>
        TextButton(onPressed: cubit.hotReload, child: const Text('Reload')),
      Reconnecting() => const SizedBox.shrink(),
      EmulatorError() =>
        TextButton(onPressed: cubit.bootAvd, child: const Text('Retry')),
    };
  }
}

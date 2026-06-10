import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';

/// Animates discrete mouse-wheel ticks into a glide instead of the default
/// abrupt jumps. Wrap a scrollable and hand it the provided controller and
/// physics.
///
/// Wheel input is intercepted and replayed as `animateTo`; trackpad pan and
/// scrollbar-thumb drags keep their native feel.
class SmoothScroll extends StatefulWidget {
  const SmoothScroll({required this.builder, super.key});

  final Widget Function(
    BuildContext context,
    ScrollController controller,
    ScrollPhysics physics,
  ) builder;

  @override
  State<SmoothScroll> createState() => _SmoothScrollState();
}

class _SmoothScrollState extends State<SmoothScroll> {
  final _controller = ScrollController();
  double _target = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    if (!_controller.hasClients) return;
    final position = _controller.position;
    if (ReduceMotion.of(context)) {
      position.pointerScroll(event.scrollDelta.dy);
      return;
    }
    final settling = position.isScrollingNotifier.value;
    final base = settling ? _target : position.pixels;
    _target = (base + event.scrollDelta.dy)
        .clamp(position.minScrollExtent, position.maxScrollExtent);
    unawaited(
      _controller.animateTo(
        _target,
        duration: PickforgeMotion.fast,
        curve: PickforgeMotion.curveOut,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerSignal: _onPointerSignal,
      child: ScrollConfiguration(
        behavior: ScrollConfiguration.of(context).copyWith(scrollbars: true),
        child: widget.builder(
          context,
          _controller,
          const _WheellessScrollPhysics(),
        ),
      ),
    );
  }
}

/// Blocks the framework's own wheel/drag handling (wheel is replayed as an
/// animation above; scrollbar-thumb drags bypass physics entirely).
class _WheellessScrollPhysics extends ClampingScrollPhysics {
  const _WheellessScrollPhysics({super.parent});

  @override
  _WheellessScrollPhysics applyTo(ScrollPhysics? ancestor) =>
      _WheellessScrollPhysics(parent: buildParent(ancestor));

  @override
  bool shouldAcceptUserOffset(ScrollMetrics position) => false;

  @override
  bool get allowImplicitScrolling => false;
}

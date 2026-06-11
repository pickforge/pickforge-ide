import 'dart:async';

import 'package:flutter/material.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// A small status dot. When [pulsing], it emits a soft expanding ring — the
/// brand "live" pulse. Honors reduced-motion (falls back to a static dot).
class EmberDot extends StatefulWidget {
  const EmberDot({
    super.key,
    this.color,
    this.size = 8,
    this.pulsing = false,
  });

  /// Dot color. Defaults to the active palette's [PickforgeColors.ember].
  final Color? color;
  final double size;
  final bool pulsing;

  @override
  State<EmberDot> createState() => _EmberDotState();
}

class _EmberDotState extends State<EmberDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: PickforgeMotion.pulse,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(EmberDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.pulsing != widget.pulsing) _sync();
  }

  void _sync() {
    final shouldRun = widget.pulsing && !ReduceMotion.of(context);
    if (shouldRun && !_controller.isAnimating) {
      unawaited(_controller.repeat());
    } else if (!shouldRun && _controller.isAnimating) {
      _controller
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? PickforgeColors.ember;
    final dot = Container(
      width: widget.size,
      height: widget.size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
    );
    if (!widget.pulsing) return dot;

    return SizedBox(
      width: widget.size * 2.6,
      height: widget.size * 2.6,
      child: Center(
        child: Stack(
          alignment: Alignment.center,
          children: [
            AnimatedBuilder(
              animation: _controller,
              builder: (context, _) {
                final t = Curves.easeOut.transform(_controller.value);
                return Container(
                  width: widget.size * (1 + t * 1.6),
                  height: widget.size * (1 + t * 1.6),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: color.withValues(alpha: (1 - t) * 0.6),
                    ),
                  ),
                );
              },
            ),
            dot,
          ],
        ),
      ),
    );
  }
}

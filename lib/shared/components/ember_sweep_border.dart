import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

/// A rounded border whose ember highlight slowly travels around the edge —
/// the brand's "live forge" frame for the one active surface in a
/// composition (e.g. the focused terminal pane).
///
/// When [active] is false it renders a plain hairline border. Honors
/// reduced-motion: the sweep freezes into a static ember border.
class EmberSweepBorder extends StatefulWidget {
  const EmberSweepBorder({
    required this.child,
    this.active = true,
    this.borderRadius = PickforgeSpacing.radiusMd,
    this.strokeWidth = 1.5,
    super.key,
  });

  final Widget child;

  /// Whether this surface carries the composition's ember. Inactive surfaces
  /// get a quiet hairline frame instead.
  final bool active;

  final double borderRadius;
  final double strokeWidth;

  @override
  State<EmberSweepBorder> createState() => _EmberSweepBorderState();
}

class _EmberSweepBorderState extends State<EmberSweepBorder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: PickforgeMotion.breath,
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(EmberSweepBorder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active) _sync();
  }

  void _sync() {
    final shouldRun = widget.active && !ReduceMotion.of(context);
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
    if (!widget.active) {
      return DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.borderRadius),
          border: Border.all(color: PickforgeColors.hairlineStrong),
        ),
        child: widget.child,
      );
    }
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) => CustomPaint(
        foregroundPainter: _SweepBorderPainter(
          progress: _controller.value,
          radius: widget.borderRadius,
          strokeWidth: widget.strokeWidth,
          ember: PickforgeColors.ember,
          emberSoft: PickforgeColors.emberSoft,
        ),
        child: child,
      ),
      child: widget.child,
    );
  }
}

class _SweepBorderPainter extends CustomPainter {
  const _SweepBorderPainter({
    required this.progress,
    required this.radius,
    required this.strokeWidth,
    required this.ember,
    required this.emberSoft,
  });

  final double progress;
  final double radius;
  final double strokeWidth;
  final Color ember;
  final Color emberSoft;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(strokeWidth / 2),
      Radius.circular(radius),
    );
    // Quiet ember base so the whole frame reads as the active one even where
    // the sweep highlight currently isn't.
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..color = ember.withValues(alpha: 0.35);
    canvas.drawRRect(rrect, base);

    final sweep = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..shader = SweepGradient(
        transform: GradientRotation(progress * 2 * math.pi),
        colors: [
          ember.withValues(alpha: 0),
          emberSoft,
          ember.withValues(alpha: 0),
        ],
        stops: const [0.0, 0.12, 0.24],
      ).createShader(rect);
    canvas.drawRRect(rrect, sweep);
  }

  @override
  bool shouldRepaint(_SweepBorderPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.radius != radius ||
      oldDelegate.strokeWidth != strokeWidth ||
      oldDelegate.ember != ember ||
      oldDelegate.emberSoft != emberSoft;
}

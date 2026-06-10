import 'package:flutter/material.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

/// The PickForge selection bracket — four L-shaped corner marks (the logo's
/// DNA) framing a child. The top-right corner is ember, echoing the mark's
/// ember dot. Use to denote the active / selected / focused element.
///
/// When [active] is false the brackets fade out (reduced-motion aware), so it
/// can be dropped into hover/selection states with an implicit transition.
class SelectionBracket extends StatelessWidget {
  const SelectionBracket({
    required this.child,
    super.key,
    this.active = true,
    this.armLength = 10,
    this.inset = 3,
    this.color = PickforgeColors.textHi,
    this.emberCorner = true,
    this.radius = PickforgeSpacing.radiusMd,
  });

  final Widget child;
  final bool active;

  /// Length of each L arm in logical px.
  final double armLength;

  /// Distance the brackets sit outside the child's box. Negative values draw
  /// the corners inside the box — use this in dense lists where there is no
  /// room around the child (the arms would bleed into neighbors and clip).
  final double inset;

  final Color color;

  /// Paint the top-right corner in ember (the mark's signature).
  final bool emberCorner;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedOpacity(
              opacity: active ? 1 : 0,
              duration: ReduceMotion.duration(context, PickforgeMotion.fast),
              curve: PickforgeMotion.forge,
              child: CustomPaint(
                painter: _BracketPainter(
                  armLength: armLength,
                  inset: inset,
                  color: color,
                  emberCorner: emberCorner,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _BracketPainter extends CustomPainter {
  _BracketPainter({
    required this.armLength,
    required this.inset,
    required this.color,
    required this.emberCorner,
  });

  final double armLength;
  final double inset;
  final Color color;
  final bool emberCorner;

  @override
  void paint(Canvas canvas, Size size) {
    final base = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final ember = Paint()
      ..color = PickforgeColors.ember
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final l = -inset;
    final r = size.width + inset;
    final t = -inset;
    final b = size.height + inset;

    // top-left
    _corner(canvas, base, Offset(l, t), 1, 1);
    // top-right (ember accent)
    _corner(canvas, emberCorner ? ember : base, Offset(r, t), -1, 1);
    // bottom-left
    _corner(canvas, base, Offset(l, b), 1, -1);
    // bottom-right
    _corner(canvas, base, Offset(r, b), -1, -1);
  }

  void _corner(Canvas canvas, Paint paint, Offset c, double sx, double sy) {
    canvas
      ..drawLine(c, c.translate(armLength * sx, 0), paint)
      ..drawLine(c, c.translate(0, armLength * sy), paint);
  }

  @override
  bool shouldRepaint(_BracketPainter old) =>
      old.armLength != armLength ||
      old.inset != inset ||
      old.color != color ||
      old.emberCorner != emberCorner;
}

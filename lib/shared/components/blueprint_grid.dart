import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// A faint blueprint grid — the brand's structural backdrop for empty states,
/// onboarding, and hero surfaces. Optionally fades toward the edges and can
/// host a soft ember halo behind its center.
class BlueprintGrid extends StatelessWidget {
  const BlueprintGrid({
    super.key,
    this.child,
    this.cell = 32,
    this.lineColor = PickforgeColors.hairline,
    this.halo = false,
    this.fade = true,
  });

  final Widget? child;
  final double cell;
  final Color lineColor;

  /// Paints a soft ember radial halo behind the center.
  final bool halo;

  /// Fades the grid out toward the edges (radial vignette).
  final bool fade;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _BlueprintPainter(cell: cell, lineColor: lineColor, fade: fade),
      foregroundPainter: halo ? _HaloPainter() : null,
      child: child,
    );
  }
}

class _BlueprintPainter extends CustomPainter {
  _BlueprintPainter({
    required this.cell,
    required this.lineColor,
    required this.fade,
  });

  final double cell;
  final Color lineColor;
  final bool fade;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = lineColor
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;

    if (fade) {
      final shader = RadialGradient(
        radius: 0.9,
        colors: [lineColor, lineColor.withValues(alpha: 0)],
      ).createShader(Offset.zero & size);
      paint
        ..color = const Color(0xFFFFFFFF)
        ..shader = shader;
    }

    for (var x = 0.0; x <= size.width; x += cell) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y <= size.height; y += cell) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(_BlueprintPainter old) =>
      old.cell != cell || old.lineColor != lineColor || old.fade != fade;
}

class _HaloPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    // A localized pocket of warmth, not a wash — most of the canvas stays
    // black so the single ember in the content can read as fire.
    final paint = Paint()
      ..shader = const RadialGradient(
        center: Alignment(0, -0.25),
        radius: 0.45,
        colors: [Color(0x21FF7A1A), Color(0x00FF7A1A)],
      ).createShader(rect);
    canvas.drawRect(rect, paint);
  }

  @override
  bool shouldRepaint(_HaloPainter oldDelegate) => false;
}

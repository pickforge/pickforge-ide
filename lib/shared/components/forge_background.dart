import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:pickforge/core/appearance/appearance_settings.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// The workbench canvas: the brand surface warmed by a soft ember glow
/// rising from the bottom — the forge below the work — with an optional
/// field of tiny embers drifting upward.
///
/// Driven by [AppearanceController] when registered; without DI (widget
/// tests, goldens) it renders the static glow only, so frames stay
/// deterministic. The particle field honors the OS reduce-motion preference
/// and the user's "animated backdrop" setting, and stays cheap: one
/// repaint-bounded painter, ~30 dots, no allocations per frame.
class ForgeBackground extends StatelessWidget {
  const ForgeBackground({super.key, this.child});

  final Widget? child;

  AppearanceController? get _controller =>
      getIt.isRegistered<AppearanceController>()
          ? getIt<AppearanceController>()
          : null;

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return _Backdrop(
        settings: AppearanceSettings.defaults,
        animationsAllowed: false,
        child: child,
      );
    }
    return ValueListenableBuilder<AppearanceSettings>(
      valueListenable: controller,
      builder: (context, settings, _) => _Backdrop(
        settings: settings,
        animationsAllowed: !ReduceMotion.of(context),
        child: child,
      ),
    );
  }
}

class _Backdrop extends StatelessWidget {
  const _Backdrop({
    required this.settings,
    required this.animationsAllowed,
    required this.child,
  });

  final AppearanceSettings settings;
  final bool animationsAllowed;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final forge = settings.backdrop == WorkbenchBackdrop.forge;
    final isDark = scheme.brightness == Brightness.dark;
    final embers = forge && settings.animatedBackdrop && animationsAllowed;
    return Stack(
      fit: StackFit.expand,
      children: [
        ColoredBox(color: scheme.surface),
        if (forge)
          DecoratedBox(
            key: const Key('forge-backdrop-glow'),
            decoration: BoxDecoration(
              // The forge below: one warm radial breathing up from beneath
              // the bottom edge. A backdrop, not an ember — it does not
              // count against the one-ember rule.
              gradient: RadialGradient(
                center: const Alignment(0, 1.35),
                radius: 1.7,
                colors: [
                  PickforgeColors.ember.withValues(alpha: isDark ? 0.26 : 0.14),
                  PickforgeColors.ember.withValues(alpha: isDark ? 0.07 : 0.04),
                  Colors.transparent,
                ],
                stops: const [0, 0.55, 1],
              ),
            ),
          ),
        if (embers)
          const RepaintBoundary(
            key: Key('forge-backdrop-embers'),
            child: _EmberField(),
          ),
        if (child != null) child!,
      ],
    );
  }
}

/// Tiny embers drifting up from the forge. Time-driven: every particle's
/// position is a pure function of the clock, so the painter holds no state
/// and never allocates per frame.
class _EmberField extends StatefulWidget {
  const _EmberField();

  @override
  State<_EmberField> createState() => _EmberFieldState();
}

class _EmberFieldState extends State<_EmberField>
    with SingleTickerProviderStateMixin {
  static const _cycle = Duration(seconds: 60);

  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: _cycle,
  )..repeat();

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      willChange: true,
      painter: _EmberFieldPainter(
        clock: _clock,
        color: PickforgeColors.ember,
      ),
    );
  }
}

class _EmberFieldPainter extends CustomPainter {
  _EmberFieldPainter({required this.clock, required this.color})
      : super(repaint: clock);

  final Animation<double> clock;
  final Color color;

  static const _count = 30;

  @override
  void paint(Canvas canvas, Size size) {
    final time = clock.value * _EmberFieldState._cycle.inSeconds;
    final paint = Paint();
    for (var i = 0; i < _count; i++) {
      // Seeded per-particle constants (golden-ratio scatter keeps them
      // uniform without a Random instance).
      final u = (i * 0.6180339887) % 1.0;
      final v = (i * 0.7548776662) % 1.0;
      final w = (i * 0.5698402910) % 1.0;
      final speed = 0.022 + u * 0.05; // full climbs per second
      final progress = (time * speed + v) % 1.0;
      final fade = math.sin(progress * math.pi); // in at bottom, out at top
      if (fade <= 0.01) continue;
      final drift =
          math.sin((progress * (2 + w * 3) + u) * 2 * math.pi) * (6 + w * 12);
      final x = v * size.width + drift;
      final y = size.height * (1 - progress);
      final radius = 0.6 + w * 1.3;
      paint.color = color.withValues(alpha: 0.38 * fade);
      canvas.drawCircle(Offset(x, y), radius, paint);
    }
  }

  @override
  bool shouldRepaint(_EmberFieldPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.clock != clock;
}

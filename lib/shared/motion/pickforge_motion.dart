import 'package:flutter/animation.dart';

/// Motion tokens for PickForge — durations and curves.
///
/// Mirrors `branding-visual/{DESIGN-TOKENS,MOTION-AND-INTERACTION}.md`.
/// There is ONE signature easing — [forge] (`cubic-bezier(0.16, 1, 0.3, 1)`):
/// snappy in, gentle out. Reach for it on reveals, selection, and hovers.
/// Everything must honor reduced-motion (see `reduce_motion.dart`).
class PickforgeMotion {
  const PickforgeMotion._();

  // ── Durations ─────────────────────────────────────────────────────────────
  /// Micro-interactions: presses, tiny state flips.
  static const Duration micro = Duration(milliseconds: 110);

  /// Quick transitions: hovers, focus rings, small fades.
  static const Duration fast = Duration(milliseconds: 180);

  /// The default transition (selection, panel content, dialogs).
  static const Duration standard = Duration(milliseconds: 260);

  /// Deliberate entrances / route transitions.
  static const Duration slow = Duration(milliseconds: 420);

  /// Cinematic reveals (onboarding hero, forge dispatch).
  static const Duration reveal = Duration(milliseconds: 640);

  /// Looping ambience: "live"/connected pulse rings.
  static const Duration pulse = Duration(milliseconds: 2400);

  /// Slow ambient ember breath behind hero/forge surfaces.
  static const Duration breath = Duration(milliseconds: 6000);

  // ── Curves ────────────────────────────────────────────────────────────────
  /// THE easing. Snappy in, gentle out. Use for reveals/selection/hover.
  static const Curve forge = Cubic(0.16, 1, 0.3, 1);

  /// Symmetric ease for two-way state (toggles, expand/collapse).
  static const Curve curve = Curves.easeInOutCubic;

  /// Exit/reveal where a gentle settle reads best.
  static const Curve curveOut = Curves.easeOutCubic;

  /// Emphasis on enter (spark, pop-in) — overshoots slightly.
  static const Curve emphasized = Curves.easeOutBack;
}

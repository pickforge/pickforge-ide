import 'package:flutter/widgets.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// Elevation tokens — the brand has *one* glow (ember), three intensities,
/// plus quiet ambient shadows for raised surfaces on the cold canvas.
///
/// Mirrors `branding-visual/DESIGN-TOKENS.md` §2.
class PickforgeElevation {
  const PickforgeElevation._();

  // ── Ember glow (use sparingly — one per composition) ──────────────────────
  /// Subtle. Default hover on ember elements.
  static const List<BoxShadow> emberSoft = [
    BoxShadow(
      color: Color(0x40FF7A1A), // 0.25
      blurRadius: 30,
      spreadRadius: -8,
    ),
  ];

  /// The default ember glow. Primary CTA, active forge node.
  static const List<BoxShadow> ember = [
    BoxShadow(
      color: Color(0x73FF7A1A), // 0.45
      blurRadius: 60,
      spreadRadius: -10,
    ),
  ];

  /// Strong. Hover on the primary CTA, "live" rings.
  static const List<BoxShadow> emberStrong = [
    BoxShadow(
      color: Color(0xA6FF7A1A), // 0.65
      blurRadius: 90,
      spreadRadius: -10,
    ),
  ];

  // ── Ambient surface shadows (neutral, for popovers/menus/dialogs) ─────────
  /// Raised panel / popover.
  static const List<BoxShadow> raised = [
    BoxShadow(
      color: Color(0x66000000),
      blurRadius: 24,
      spreadRadius: -6,
      offset: Offset(0, 8),
    ),
  ];

  /// Overlay / dialog / command palette.
  static const List<BoxShadow> overlay = [
    BoxShadow(
      color: Color(0x99000000),
      blurRadius: 48,
      spreadRadius: -10,
      offset: Offset(0, 16),
    ),
  ];

  /// A soft radial ember halo as a backdrop (not an ember — exempt from the
  /// one-ember rule). Use behind hero / forge surfaces.
  static RadialGradient emberHalo({double radius = 0.8}) => RadialGradient(
        radius: radius,
        colors: const [PickforgeColors.emberGlow, Color(0x00FF7A1A)],
      );
}

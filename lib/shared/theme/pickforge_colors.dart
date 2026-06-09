import 'package:flutter/widgets.dart';

/// PickForge color tokens — the single source of truth for color in the app.
///
/// Mirrors `branding-visual/DESIGN-TOKENS.md`. The brand is dark-first: one
/// ember on a cold canvas. The rule is **one ember per composition** — pick a
/// single ember value for a surface and move on; never daisy-chain the shades.
///
/// Never type a raw hex in a widget. If a token is missing, add it here first.
class PickforgeColors {
  const PickforgeColors._();

  // ── Surfaces (the canvas) ────────────────────────────────────────────────
  /// Base page background. The brand black.
  static const surface = Color(0xFF0A0A0B);

  /// First elevation — cards, panels, sidebars.
  static const surface1 = Color(0xFF0F0F11);

  /// Second elevation — raised panels, hover fills, terminal chrome.
  static const surface2 = Color(0xFF141417);

  /// Third elevation — popovers, menus, tooltips (slightly lifted off s2).
  static const surface3 = Color(0xFF1B1B1F);

  // Back-compat aliases (older code referenced bg0/bg1/bg2). Keep in sync.
  static const Color bg0 = surface;
  static const Color bg1 = surface1;
  static const Color bg2 = surface2;

  // ── Text ─────────────────────────────────────────────────────────────────
  /// Primary text. Off-white, not pure white — softer on the eyes.
  static const textHi = Color(0xFFF2F2F3);

  /// Mid-emphasis text, icons, secondary labels (denser dev-tool ramp step).
  static const textMed = Color(0xFFA0A0A6);

  /// Muted text, eyebrows, captions, monospace labels.
  static const textLow = Color(0xFF6E6E75);

  /// Brand alias for [textLow].
  static const Color muted = textLow;

  // ── Ember (the one accent) ───────────────────────────────────────────────
  /// THE accent. CTAs, selection rings, live status, active node.
  static const ember = Color(0xFFFF7A1A);

  /// Hover state for ember. Lighter, warmer.
  static const emberSoft = Color(0xFFFF9A4A);

  /// Pressed / darkest ember. Use sparingly (focus-ring borders).
  static const emberDeep = Color(0xFFCC5E0C);

  // ── Hairlines / borders ──────────────────────────────────────────────────
  /// The default border. The brand hairline (8% white).
  static const hairline = Color(0x14FFFFFF);

  /// Strong hairline — glass-strong borders, dividers (14% white).
  static const hairlineStrong = Color(0x24FFFFFF);

  /// Back-compat alias for [hairline].
  static const Color stroke = hairline;

  // ── Status / semantic (functional, kept minimal) ─────────────────────────
  /// Shipped / connected / online.
  static const connected = Color(0xFF3DD68C);

  /// Warning / beta.
  static const warning = Color(0xFFF2B53A);

  /// Error.
  static const error = Color(0xFFFF6B5C);

  /// Info / neutral secondary accent.
  static const info = Color(0xFF7AA2FF);

  // ── Ember glow (the one glow, three intensities) ─────────────────────────
  /// Radial halo behind hero/forge moments (a backdrop, not an ember — does
  /// not count against the one-ember rule).
  static const emberGlow = Color(0x47FF7A1A); // ~28% ember
}

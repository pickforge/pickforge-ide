import 'package:flutter/widgets.dart';

/// One full set of brand color tokens. Two instances exist — [dark] (the
/// canonical brand canvas) and [light] (the inversion map from
/// `branding-visual/DARK-LIGHT-MODE.md` §3) — and the active one is exposed
/// through [PickforgeColors].
class PickforgePalette {
  const PickforgePalette({
    required this.brightness,
    required this.surface,
    required this.surface1,
    required this.surface2,
    required this.surface3,
    required this.textHi,
    required this.textMed,
    required this.textLow,
    required this.ember,
    required this.emberSoft,
    required this.emberDeep,
    required this.hairline,
    required this.hairlineStrong,
    required this.itemFill,
    required this.connected,
    required this.warning,
    required this.error,
    required this.info,
    required this.emberGlow,
  });

  final Brightness brightness;
  final Color surface;
  final Color surface1;
  final Color surface2;
  final Color surface3;
  final Color textHi;
  final Color textMed;
  final Color textLow;
  final Color ember;
  final Color emberSoft;
  final Color emberDeep;
  final Color hairline;
  final Color hairlineStrong;
  final Color itemFill;
  final Color connected;
  final Color warning;
  final Color error;
  final Color info;
  final Color emberGlow;

  /// The canonical brand mode: one ember on a cold near-black canvas.
  static const dark = PickforgePalette(
    brightness: Brightness.dark,
    surface: Color(0xFF0A0A0B),
    surface1: Color(0xFF0F0F11),
    surface2: Color(0xFF141417),
    surface3: Color(0xFF1B1B1F),
    textHi: Color(0xFFF2F2F3),
    textMed: Color(0xFFA0A0A6),
    textLow: Color(0xFF6E6E75),
    ember: Color(0xFFFF7A1A),
    emberSoft: Color(0xFFFF9A4A),
    emberDeep: Color(0xFFCC5E0C),
    hairline: Color(0x14FFFFFF),
    hairlineStrong: Color(0x24FFFFFF),
    itemFill: Color(0x08FFFFFF),
    connected: Color(0xFF3DD68C),
    warning: Color(0xFFF2B53A),
    error: Color(0xFFFF6B5C),
    info: Color(0xFF7AA2FF),
    emberGlow: Color(0x47FF7A1A), // ~28% ember
  );

  /// The light adaptation layer: warm cream canvas, near-black text, the
  /// ember slightly darkened for AA contrast. Token-for-token from
  /// DARK-LIGHT-MODE.md — never pure white, never pure black.
  static const light = PickforgePalette(
    brightness: Brightness.light,
    surface: Color(0xFFFAFAF7),
    surface1: Color(0xFFFFFFFF),
    surface2: Color(0xFFF2F2EE),
    surface3: Color(0xFFE9E9E4),
    textHi: Color(0xFF17171A),
    textMed: Color(0xFF55555C),
    textLow: Color(0xFF6E6E75),
    ember: Color(0xFFE5610A),
    emberSoft: Color(0xFFF58220),
    emberDeep: Color(0xFFB14C00),
    hairline: Color(0x1417171A),
    hairlineStrong: Color(0x2417171A),
    itemFill: Color(0x0817171A),
    connected: Color(0xFF1FA76A),
    warning: Color(0xFFB07D18),
    error: Color(0xFFD0453B),
    info: Color(0xFF3A5BD6),
    emberGlow: Color(0x2EE5610A), // lower opacity on the reflective canvas
  );
}

/// PickForge color tokens — the single source of truth for color in the app.
///
/// Mirrors `branding-visual/DESIGN-TOKENS.md`. The brand is dark-first: one
/// ember on a cold canvas. The rule is **one ember per composition** — pick a
/// single ember value for a surface and move on; never daisy-chain the shades.
///
/// The tokens resolve against the active [PickforgePalette]; the appearance
/// controller swaps it (and rebuilds the app) when the theme mode changes.
/// Never type a raw hex in a widget. If a token is missing, add it to
/// [PickforgePalette] first.
class PickforgeColors {
  const PickforgeColors._();

  /// The active palette. Set only by the appearance controller, immediately
  /// before rebuilding the widget tree.
  static PickforgePalette palette = PickforgePalette.dark;

  static PickforgePalette get _palette => palette;

  // ── Surfaces (the canvas) ────────────────────────────────────────────────
  /// Base page background (`--color-surface`).
  static Color get surface => _palette.surface;

  /// First elevation — cards, panels, sidebars (`--color-surface-1`).
  static Color get surface1 => _palette.surface1;

  /// Second elevation — raised panels, hover fills (`--color-surface-2`).
  static Color get surface2 => _palette.surface2;

  /// Third elevation — popovers, menus, tooltips.
  static Color get surface3 => _palette.surface3;

  // Back-compat aliases (older code referenced bg0/bg1/bg2). Keep in sync.
  static Color get bg0 => surface;
  static Color get bg1 => surface1;
  static Color get bg2 => surface2;

  // ── Text ─────────────────────────────────────────────────────────────────
  /// Primary text. Off-white in dark, near-black in light — never pure.
  static Color get textHi => _palette.textHi;

  /// Mid-emphasis text, icons, secondary labels (denser dev-tool ramp step).
  static Color get textMed => _palette.textMed;

  /// Muted text, eyebrows, captions, monospace labels. Same in both modes.
  static Color get textLow => _palette.textLow;

  /// Brand alias for [textLow].
  static Color get muted => textLow;

  // ── Ember (the one accent) ───────────────────────────────────────────────
  /// THE accent. CTAs, selection rings, live status, active node.
  static Color get ember => _palette.ember;

  /// Hover state for ember. Lighter, warmer.
  static Color get emberSoft => _palette.emberSoft;

  /// Pressed / darkest ember. Use sparingly (focus-ring borders).
  static Color get emberDeep => _palette.emberDeep;

  // ── Hairlines / borders ──────────────────────────────────────────────────
  /// The default border. The brand hairline (8%).
  static Color get hairline => _palette.hairline;

  /// Strong hairline — glass-strong borders, dividers (14%).
  static Color get hairlineStrong => _palette.hairlineStrong;

  /// Back-compat alias for [hairline].
  static Color get stroke => hairline;

  /// Faint fill that lifts stacked list items off the canvas (3%).
  static Color get itemFill => _palette.itemFill;

  // ── Status / semantic (functional, kept minimal) ─────────────────────────
  /// Shipped / connected / online.
  static Color get connected => _palette.connected;

  /// Warning / beta.
  static Color get warning => _palette.warning;

  /// Error.
  static Color get error => _palette.error;

  /// Info / neutral secondary accent.
  static Color get info => _palette.info;

  // ── Ember glow (the one glow, three intensities) ─────────────────────────
  /// Radial halo behind hero/forge moments (a backdrop, not an ember — does
  /// not count against the one-ember rule).
  static Color get emberGlow => _palette.emberGlow;
}

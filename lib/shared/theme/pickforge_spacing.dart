/// 8px grid spacing + radius tokens. Use these, never magic numbers.
///
/// Mirrors `branding-visual/DESIGN-TOKENS.md` §4.
class PickforgeSpacing {
  const PickforgeSpacing._();

  // Spacing — 8px grid (xs is the 4px half-step).
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const xxxl = 48.0;

  // Radii.
  static const radiusSm = 6.0; // chips, small controls
  static const radiusMd = 10.0; // inputs, buttons (rectangular)
  static const radiusLg = 14.0; // cards, panels — the brand card radius
  static const radiusXl = 16.0; // large containers
  static const radiusPill = 999.0; // pills, status chips, eyebrow chips
}

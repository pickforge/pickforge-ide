import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// PickForge typography — Geist (the human voice) + Geist Mono (the machine
/// voice). Mirrors `branding-visual/TYPOGRAPHY.md`.
///
/// Display sizes carry tight tracking; mono eyebrows carry the widest. Body is
/// 13px by default for dev-tool density.
const String kPickforgeSans = 'Geist';
const String kPickforgeMono = 'GeistMono';

/// Full type scale. `letterSpacing` is in logical px (brand spec is in em —
/// converted here per size).
TextTheme pickforgeTextTheme({required Brightness brightness}) {
  final hi = brightness == Brightness.dark
      ? PickforgeColors.textHi
      : const Color(0xFF0A0A0B);
  final med = brightness == Brightness.dark
      ? PickforgeColors.textMed
      : const Color(0xFF55555C);

  TextStyle sans(
    double size,
    FontWeight weight, {
    double tracking = 0,
    double? height,
    Color? color,
  }) =>
      TextStyle(
        fontFamily: kPickforgeSans,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: tracking,
        height: height,
        color: color ?? hi,
      );

  return TextTheme(
    // Display — hero / big moments. Tight tracking (~-0.02em).
    displayLarge: sans(42, FontWeight.w700, tracking: -0.8, height: 1.05),
    displayMedium: sans(34, FontWeight.w700, tracking: -0.6, height: 1.08),
    displaySmall: sans(28, FontWeight.w600, tracking: -0.5, height: 1.12),
    // Headlines — section / stage headers.
    headlineLarge: sans(25, FontWeight.w600, tracking: -0.4, height: 1.15),
    headlineMedium: sans(21, FontWeight.w600, tracking: -0.3, height: 1.2),
    headlineSmall: sans(18, FontWeight.w600, tracking: -0.2, height: 1.25),
    // Titles — card / panel titles, list headers.
    titleLarge: sans(16, FontWeight.w600, tracking: -0.1),
    titleMedium: sans(14, FontWeight.w600),
    titleSmall: sans(13, FontWeight.w600),
    // Body.
    bodyLarge: sans(15, FontWeight.w400, height: 1.5),
    bodyMedium: sans(13, FontWeight.w400, height: 1.45),
    bodySmall: sans(12, FontWeight.w400, height: 1.4, color: med),
    // Labels — buttons, chips, captions.
    labelLarge: sans(13, FontWeight.w500, tracking: 0.1),
    labelMedium: sans(12, FontWeight.w500, tracking: 0.2, color: med),
    labelSmall: sans(11, FontWeight.w500, tracking: 0.3, color: med),
  );
}

/// Signature mono styles (eyebrows / machine labels).
class PickforgeText {
  const PickforgeText._();

  /// Uppercase monospace eyebrow — widest tracking (~0.18em @ 10px ≈ 1.8px).
  static const TextStyle eyebrow = TextStyle(
    fontFamily: kPickforgeMono,
    fontSize: 10,
    fontWeight: FontWeight.w500,
    letterSpacing: 1.8,
    height: 1.2,
    color: PickforgeColors.muted,
  );

  /// Inline mono — IDs, paths, tabular values.
  static const TextStyle mono = TextStyle(
    fontFamily: kPickforgeMono,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.4,
    fontFeatures: [FontFeature.tabularFigures()],
    color: PickforgeColors.textMed,
  );
}

/// Theme extension carrying the monospace family for code/terminal surfaces.
class PickforgeMonoTheme extends ThemeExtension<PickforgeMonoTheme> {
  const PickforgeMonoTheme({required this.fontFamily});
  final String fontFamily;

  @override
  PickforgeMonoTheme copyWith({String? fontFamily}) =>
      PickforgeMonoTheme(fontFamily: fontFamily ?? this.fontFamily);

  @override
  PickforgeMonoTheme lerp(
    ThemeExtension<PickforgeMonoTheme>? other,
    double t,
  ) =>
      this;
}

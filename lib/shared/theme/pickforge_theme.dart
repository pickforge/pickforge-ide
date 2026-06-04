import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

export 'package:pickforge/shared/theme/pickforge_typography.dart'
    show PickforgeMonoTheme;

/// Pickforge theme. Comprehensively overrides Material 3 defaults — never
/// leak Material's default spacing, color, or typography into the UI.
class PickforgeTheme {
  const PickforgeTheme._();

  static ThemeData dark() => _build(Brightness.dark);
  static ThemeData light() => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: PickforgeColors.ember,
      onPrimary: PickforgeColors.bg0,
      secondary: PickforgeColors.info,
      onSecondary: PickforgeColors.bg0,
      surface: isDark ? PickforgeColors.bg0 : const Color(0xFFF7F7F8),
      onSurface: isDark ? PickforgeColors.textHi : const Color(0xFF0A0A0B),
      error: PickforgeColors.error,
      onError: PickforgeColors.bg0,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: colorScheme.surface,
      textTheme: pickforgeTextTheme(brightness: brightness),
      extensions: const [PickforgeMonoTheme(fontFamily: 'JetBrainsMono')],
      splashFactory: NoSplash.splashFactory,
      visualDensity: VisualDensity.compact,
    );
  }
}

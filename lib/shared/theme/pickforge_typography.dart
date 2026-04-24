import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';

/// Typography scale. 13px body (dev-tool density), tight letter spacing.
TextTheme pickforgeTextTheme({required Brightness brightness}) {
  final text = brightness == Brightness.dark
      ? PickforgeColors.textHi
      : const Color(0xFF0A0A0B);
  return TextTheme(
    displayLarge: TextStyle(
      fontFamily: 'Inter',
      fontSize: 28,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.5,
      color: text,
    ),
    titleLarge: TextStyle(
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.2,
      color: text,
    ),
    bodyMedium: TextStyle(
      fontFamily: 'Inter',
      fontSize: 13,
      fontWeight: FontWeight.w400,
      height: 1.4,
      color: text,
    ),
    labelSmall: TextStyle(
      fontFamily: 'Inter',
      fontSize: 11,
      fontWeight: FontWeight.w500,
      letterSpacing: 0.4,
      color: text,
    ),
  );
}

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

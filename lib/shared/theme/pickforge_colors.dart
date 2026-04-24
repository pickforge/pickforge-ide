import 'package:flutter/widgets.dart';

/// Pickforge color tokens. Semantic only — orange = user action, green =
/// connected, amber = warning, red = error, muted blue = info.
class PickforgeColors {
  const PickforgeColors._();

  // Base surfaces (dark)
  static const bg0 = Color(0xFF0A0A0B); // page bg
  static const bg1 = Color(0xFF111113); // panel bg
  static const bg2 = Color(0xFF17171A); // raised panel
  static const stroke = Color(0x1AFFFFFF); // 10% white

  // Text
  static const textHi = Color(0xFFF2F2F3);
  static const textMed = Color(0xFFA0A0A6);
  static const textLow = Color(0xFF6E6E75);

  // Semantic
  static const ember = Color(0xFFFF7A1A); // primary accent
  static const connected = Color(0xFF3DD68C);
  static const warning = Color(0xFFF2B53A);
  static const error = Color(0xFFFF6B5C);
  static const info = Color(0xFF7AA2FF);
}

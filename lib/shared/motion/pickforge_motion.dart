import 'package:flutter/material.dart';

/// Motion duration and curve tokens for Pickforge animations.
class PickforgeMotion {
  const PickforgeMotion._();

  static const Duration fast = Duration(milliseconds: 150);
  static const Duration standard = Duration(milliseconds: 250);
  static const Duration slow = Duration(milliseconds: 400);

  static const Curve curve = Curves.easeInOut;
  static const Curve curveOut = Curves.easeOut;
}

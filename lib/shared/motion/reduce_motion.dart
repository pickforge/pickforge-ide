import 'package:flutter/widgets.dart';

class ReduceMotion {
  const ReduceMotion._();

  static bool of(BuildContext context) =>
      MediaQuery.of(context).disableAnimations;

  static Duration duration(BuildContext context, Duration normal) =>
      of(context) ? Duration.zero : normal;
}

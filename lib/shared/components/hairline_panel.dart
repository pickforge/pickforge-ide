import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

/// A surface panel with the brand hairline border — the base building block
/// for cards, sidebars, and grouped content on the cold canvas.
///
/// [glass] adds a faint top-down gradient (surface-1 → surface-2) for a subtle
/// "glass card" lift. [strong] uses the 14% hairline instead of the 8%.
class HairlinePanel extends StatelessWidget {
  const HairlinePanel({
    required this.child,
    super.key,
    this.padding = const EdgeInsets.all(PickforgeSpacing.lg),
    this.radius = PickforgeSpacing.radiusLg,
    this.color,
    this.glass = false,
    this.strong = false,
    this.borderColor,
    this.shadows,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;

  /// Fill color. Defaults to the active palette's [PickforgeColors.surface1].
  final Color? color;
  final bool glass;
  final bool strong;
  final Color? borderColor;
  final List<BoxShadow>? shadows;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: glass ? null : color ?? PickforgeColors.surface1,
        gradient: glass
            ? LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [PickforgeColors.surface1, PickforgeColors.surface2],
              )
            : null,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: borderColor ??
              (strong
                  ? PickforgeColors.hairlineStrong
                  : PickforgeColors.hairline),
        ),
        boxShadow: shadows,
      ),
      child: child,
    );
  }
}

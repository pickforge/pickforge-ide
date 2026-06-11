import 'package:flutter/material.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// A monospace, uppercase, wide-tracked label — the brand's "machine voice"
/// eyebrow. Used above section titles and as small structural labels.
///
/// Optionally prefixed by a small ember tick (`▍`) to echo the forge mark.
class MonoEyebrow extends StatelessWidget {
  const MonoEyebrow(
    this.text, {
    super.key,
    this.color,
    this.tick = false,
    this.tickColor,
  });

  final String text;
  final Color? color;

  /// Draws a small ember tick before the label.
  final bool tick;

  /// Tick color. Defaults to the active palette's [PickforgeColors.ember].
  final Color? tickColor;

  @override
  Widget build(BuildContext context) {
    final style = PickforgeText.eyebrow.copyWith(color: color);
    if (!tick) {
      return Text(text.toUpperCase(), style: style);
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 3,
          height: 10,
          decoration: BoxDecoration(
            color: tickColor ?? PickforgeColors.ember,
            borderRadius: BorderRadius.circular(1),
          ),
        ),
        const SizedBox(width: 7),
        Text(text.toUpperCase(), style: style),
      ],
    );
  }
}

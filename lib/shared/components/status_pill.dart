import 'package:flutter/material.dart';
import 'package:pickforge/shared/components/ember_pulse.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// Semantic intent for a [StatusPill] / dot.
enum StatusIntent { neutral, live, connected, warning, error, info }

extension StatusIntentColor on StatusIntent {
  Color get color => switch (this) {
        StatusIntent.neutral => PickforgeColors.textLow,
        StatusIntent.live => PickforgeColors.ember,
        StatusIntent.connected => PickforgeColors.connected,
        StatusIntent.warning => PickforgeColors.warning,
        StatusIntent.error => PickforgeColors.error,
        StatusIntent.info => PickforgeColors.info,
      };
}

/// A small monospace status chip with a leading dot. The brand "status pill".
///
/// When [pulsing] is true and the intent is [StatusIntent.live] (or any), the
/// dot breathes with an ember-style pulse ring (reduced-motion aware).
class StatusPill extends StatelessWidget {
  const StatusPill({
    required this.label,
    super.key,
    this.intent = StatusIntent.neutral,
    this.pulsing = false,
  });

  final String label;
  final StatusIntent intent;
  final bool pulsing;

  @override
  Widget build(BuildContext context) {
    final color = intent.color;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.sm + 2,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusPill),
        border: Border.all(color: color.withValues(alpha: 0.30)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          EmberDot(color: color, pulsing: pulsing),
          const SizedBox(width: 7),
          Text(
            label.toUpperCase(),
            style: PickforgeText.eyebrow.copyWith(
              color: color,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:pickforge/core/targets/target_workflows.dart';
import 'package:pickforge/shared/components/status_pill.dart';

/// The capability/support-level badge for the active target — a brand
/// [StatusPill] whose intent and label come from the [TargetSupportLevel].
///
/// Deferred from M2 (capability badges) to here: it now has a real adapter and
/// support-level model to render.
class TargetSupportBadge extends StatelessWidget {
  const TargetSupportBadge({required this.level, super.key});

  final TargetSupportLevel level;

  @override
  Widget build(BuildContext context) {
    return StatusPill(label: level.label, intent: _intent);
  }

  StatusIntent get _intent => switch (level) {
        TargetSupportLevel.deep => StatusIntent.connected,
        TargetSupportLevel.useful => StatusIntent.info,
        TargetSupportLevel.experimental => StatusIntent.warning,
        TargetSupportLevel.manualOnly => StatusIntent.neutral,
      };
}

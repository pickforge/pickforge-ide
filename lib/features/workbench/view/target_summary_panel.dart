import 'package:flutter/material.dart';
import 'package:pickforge/core/targets/target_workflows.dart';
import 'package:pickforge/features/workbench/view/target_support_badge.dart';
import 'package:pickforge/shared/components/hairline_panel.dart';
import 'package:pickforge/shared/components/mono_eyebrow.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// The active-target summary for the workbench: the detected target, its
/// support-level badge, and the capability-gated agent workflows it offers.
class TargetSummaryPanel extends StatelessWidget {
  const TargetSummaryPanel({
    required this.displayName,
    required this.supportLevel,
    required this.workflows,
    super.key,
  });

  final String displayName;
  final TargetSupportLevel supportLevel;
  final Set<TargetWorkflow> workflows;

  @override
  Widget build(BuildContext context) {
    final ordered =
        TargetWorkflow.values.where(workflows.contains).toList(growable: false);
    return HairlinePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const MonoEyebrow('Active target'),
              const Spacer(),
              TargetSupportBadge(level: supportLevel),
            ],
          ),
          const SizedBox(height: PickforgeSpacing.sm),
          Text(displayName, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: PickforgeSpacing.lg),
          const MonoEyebrow('Workflows'),
          const SizedBox(height: PickforgeSpacing.sm),
          if (ordered.isEmpty)
            Text(
              'No selection workflows for this target.',
              style:
                  PickforgeText.mono.copyWith(color: PickforgeColors.textLow),
            )
          else
            Wrap(
              spacing: PickforgeSpacing.sm,
              runSpacing: PickforgeSpacing.sm,
              children: [
                for (final workflow in ordered) _WorkflowChip(workflow.label),
              ],
            ),
        ],
      ),
    );
  }
}

class _WorkflowChip extends StatelessWidget {
  const _WorkflowChip(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.sm,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: PickforgeColors.surface2,
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
        border: Border.all(color: PickforgeColors.hairline),
      ),
      child: Text(
        label,
        style: PickforgeText.mono.copyWith(
          fontSize: 11,
          color: PickforgeColors.textMed,
        ),
      ),
    );
  }
}

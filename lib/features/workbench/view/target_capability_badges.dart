import 'package:flutter/material.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/shared/components/status_pill.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

/// The capability badges for a target: one [StatusPill] per operation the
/// workbench can offer, lit when the adapter declares it and muted when it
/// doesn't. Showing the muted ones is deliberate — it stops the UI from
/// overstating support depth (M2 / "done criteria").
class TargetCapabilityBadges extends StatelessWidget {
  const TargetCapabilityBadges({required this.capabilities, super.key});

  final TargetCapabilities capabilities;

  /// The user-facing badges, in display order, each backed by one capability.
  static const _badges = <(String, TargetCapability)>[
    ('Run', TargetCapability.launch),
    ('Logs', TargetCapability.streamLogs),
    ('Screenshot', TargetCapability.captureScreenshot),
    ('Inspect', TargetCapability.inspectSelection),
    ('Source map', TargetCapability.mapSelectionToSource),
    ('Hot reload', TargetCapability.hotReload),
    ('MCP', TargetCapability.exposeMcpTools),
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: PickforgeSpacing.sm,
      runSpacing: PickforgeSpacing.sm,
      children: [
        for (final (label, capability) in _badges)
          StatusPill(
            label: label,
            intent: capabilities.has(capability)
                ? StatusIntent.connected
                : StatusIntent.neutral,
          ),
      ],
    );
  }
}

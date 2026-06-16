import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:pickforge/shared/components/hairline_panel.dart';
import 'package:pickforge/shared/components/mono_eyebrow.dart';
import 'package:pickforge/shared/components/status_pill.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// The outcome of a tool/runtime availability check.
enum DoctorStatus { ok, missing, unknown }

extension DoctorStatusVisuals on DoctorStatus {
  StatusIntent get intent => switch (this) {
        DoctorStatus.ok => StatusIntent.connected,
        DoctorStatus.missing => StatusIntent.error,
        DoctorStatus.unknown => StatusIntent.neutral,
      };

  String get label => switch (this) {
        DoctorStatus.ok => 'OK',
        DoctorStatus.missing => 'Missing',
        DoctorStatus.unknown => 'Unknown',
      };
}

/// A single environment check (e.g. "ADB", "Xcode", "Node").
class DoctorCheck extends Equatable {
  const DoctorCheck({required this.label, required this.status, this.detail});

  final String label;
  final DoctorStatus status;
  final String? detail;

  @override
  List<Object?> get props => [label, status, detail];
}

/// Lists the toolchain checks that gate a target's runtime features, so a user
/// can see at a glance why a capability is or isn't available.
class AdapterDoctorPanel extends StatelessWidget {
  const AdapterDoctorPanel({required this.checks, super.key});

  final List<DoctorCheck> checks;

  @override
  Widget build(BuildContext context) {
    return HairlinePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const MonoEyebrow('Doctor'),
          const SizedBox(height: PickforgeSpacing.md),
          for (var i = 0; i < checks.length; i++) ...[
            if (i > 0) const SizedBox(height: PickforgeSpacing.sm),
            _CheckRow(checks[i]),
          ],
        ],
      ),
    );
  }
}

class _CheckRow extends StatelessWidget {
  const _CheckRow(this.check);

  final DoctorCheck check;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                check.label,
                style:
                    PickforgeText.mono.copyWith(color: PickforgeColors.textHi),
              ),
              if (check.detail != null)
                Text(
                  check.detail!,
                  style: PickforgeText.mono.copyWith(
                    fontSize: 11,
                    color: PickforgeColors.textLow,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(width: PickforgeSpacing.md),
        StatusPill(label: check.status.label, intent: check.status.intent),
      ],
    );
  }
}

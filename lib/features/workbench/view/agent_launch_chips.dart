import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/agent/agent_model_settings.dart';
import 'package:pickforge/core/agent/agent_profile_registry.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/process/binary_detector.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/features/workbench/cubit/agent_launch_chips_cubit.dart';
import 'package:pickforge/features/workbench/cubit/agent_launch_chips_state.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/mono_eyebrow.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// Quick-launch strip above the embedded terminal: one chip per agent CLI.
/// A chip types its launch command at the prompt without running it.
class AgentLaunchChips extends StatelessWidget {
  const AgentLaunchChips({
    required this.projectRoot,
    required this.chatAgentId,
    required this.enabled,
    required this.onLaunch,
    super.key,
  });

  final String projectRoot;
  final String chatAgentId;
  final bool enabled;
  final ValueChanged<String> onLaunch;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) {
        final cubit = AgentLaunchChipsCubit(
          getIt<AgentProfileRegistry>(),
          getIt<BinaryDetector>(),
          getIt.isRegistered<AgentModelSettingsRepository>()
              ? getIt<AgentModelSettingsRepository>()
              : null,
          getIt<ProjectSettingsRepository>(),
        );
        unawaited(
          cubit.load(projectRoot: projectRoot, chatAgentId: chatAgentId),
        );
        return cubit;
      },
      child: BlocBuilder<AgentLaunchChipsCubit, AgentLaunchChipsState>(
        builder: (context, state) {
          if (!state.loaded) return const SizedBox(height: 36);
          final l10n = AppLocalizations.of(context);
          return SizedBox(
            height: 36,
            child: Row(
              children: [
                const SizedBox(width: PickforgeSpacing.md),
                MonoEyebrow(
                  l10n.terminalQuickLaunch,
                  color: PickforgeColors.textLow,
                ),
                const SizedBox(width: PickforgeSpacing.md),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final chip in state.chips) ...[
                          _LaunchChip(
                            chip: chip,
                            enabled: enabled && chip.available,
                            missingTooltip: l10n.terminalBinaryMissingTooltip(
                              chip.binary,
                            ),
                            onPressed: () => onLaunch(chip.command),
                          ),
                          const SizedBox(width: PickforgeSpacing.sm),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _LaunchChip extends StatefulWidget {
  const _LaunchChip({
    required this.chip,
    required this.enabled,
    required this.missingTooltip,
    required this.onPressed,
  });

  final AgentLaunchChip chip;
  final bool enabled;
  final String missingTooltip;
  final VoidCallback onPressed;

  @override
  State<_LaunchChip> createState() => _LaunchChipState();
}

class _LaunchChipState extends State<_LaunchChip> {
  var _hovered = false;

  @override
  Widget build(BuildContext context) {
    final chip = widget.chip;
    final accent = chip.emphasized && chip.available;
    final Color border;
    final Color text;
    if (!chip.available) {
      border = PickforgeColors.hairline;
      text = PickforgeColors.textLow;
    } else if (accent) {
      border = PickforgeColors.ember;
      text = PickforgeColors.ember;
    } else {
      border =
          _hovered ? PickforgeColors.hairlineStrong : PickforgeColors.hairline;
      text = _hovered ? PickforgeColors.textHi : PickforgeColors.textMed;
    }

    return Tooltip(
      message: chip.available ? chip.command : widget.missingTooltip,
      waitDuration: const Duration(milliseconds: 400),
      child: MouseRegion(
        cursor: widget.enabled
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        child: GestureDetector(
          onTap: widget.enabled ? widget.onPressed : null,
          child: AnimatedContainer(
            duration: ReduceMotion.duration(context, PickforgeMotion.fast),
            curve: PickforgeMotion.forge,
            padding: const EdgeInsets.symmetric(
              horizontal: PickforgeSpacing.md,
              vertical: PickforgeSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: _hovered && widget.enabled
                  ? PickforgeColors.surface2
                  : PickforgeColors.surface1,
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusPill),
              border: Border.all(color: border),
            ),
            child: Text(
              chip.label.toUpperCase(),
              style: PickforgeText.eyebrow.copyWith(color: text),
            ),
          ),
        ),
      ),
    );
  }
}

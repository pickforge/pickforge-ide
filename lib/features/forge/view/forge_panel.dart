import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/terminal/terminal_profile_registry.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';
import 'package:pickforge/features/forge/widgets/agent_picker.dart';
import 'package:pickforge/features/forge/widgets/skill_picker.dart';
import 'package:pickforge/features/forge/widgets/terminal_picker.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ForgePanel extends StatelessWidget {
  const ForgePanel({
    required this.selection,
    required this.projectRoot,
    super.key,
  });

  final SelectedWidget? selection;
  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => getIt<ForgeCubit>(),
      child: _ForgePanelBody(selection: selection, projectRoot: projectRoot),
    );
  }
}

class _ForgePanelBody extends StatelessWidget {
  const _ForgePanelBody({
    required this.selection,
    required this.projectRoot,
  });

  final SelectedWidget? selection;
  final String projectRoot;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final registry = getIt<TerminalProfileRegistry>();

    return BlocBuilder<ForgeCubit, ForgeState>(
      builder: (context, state) {
        final cubit = context.read<ForgeCubit>();
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Row(
            children: [
              SkillPicker(
                value: state.skill,
                onChanged: cubit.selectSkill,
              ),
              AgentPicker(
                value: state.agentId,
                onChanged: cubit.selectAgent,
              ),
              TerminalPicker(
                available: registry.availableOnThisOs(),
                value: state.terminalId,
                onChanged: cubit.selectTerminal,
              ),
              const Spacer(),
              FilledButton(
                onPressed: (selection == null || state.launching)
                    ? null
                    : () => cubit.forge(
                          selection: selection!,
                          projectRoot: projectRoot,
                          chatId: 'legacy-forge-panel',
                        ),
                child: Text(l10n.forgeItButton),
              ),
            ],
          ),
        );
      },
    );
  }
}

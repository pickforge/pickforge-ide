import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';
import 'package:pickforge/features/forge/widgets/agent_picker.dart';
import 'package:pickforge/features/forge/widgets/skill_picker.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';

class ForgePanel extends StatelessWidget {
  const ForgePanel({
    required this.selection,
    required this.projectRoot,
    required this.chatId,
    this.cubit,
    super.key,
  });

  final SelectedWidget? selection;
  final String projectRoot;
  final String? chatId;
  final ForgeCubit? cubit;

  @override
  Widget build(BuildContext context) {
    if (cubit != null) {
      return BlocProvider.value(
        value: cubit!,
        child: _ForgePanelBody(
          selection: selection,
          projectRoot: projectRoot,
          chatId: chatId,
        ),
      );
    }
    try {
      context.read<ForgeCubit>();
      return _ForgePanelBody(
        selection: selection,
        projectRoot: projectRoot,
        chatId: chatId,
      );
    } on ProviderNotFoundException {
      return BlocProvider(
        create: (_) => getIt<ForgeCubit>(),
        child: _ForgePanelBody(
          selection: selection,
          projectRoot: projectRoot,
          chatId: chatId,
        ),
      );
    }
  }
}

class _ForgePanelBody extends StatelessWidget {
  const _ForgePanelBody({
    required this.selection,
    required this.projectRoot,
    required this.chatId,
  });

  final SelectedWidget? selection;
  final String projectRoot;
  final String? chatId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return BlocBuilder<ForgeCubit, ForgeState>(
      builder: (context, state) {
        final cubit = context.read<ForgeCubit>();
        final canForge = selection != null && chatId != null;
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
              const Spacer(),
              FilledButton(
                onPressed: (!canForge || state.launching)
                    ? null
                    : () => cubit.forge(
                          selection: selection!,
                          projectRoot: projectRoot,
                          chatId: chatId!,
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

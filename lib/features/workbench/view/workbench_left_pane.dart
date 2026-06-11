import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:pickforge/features/workbench/cubit/projects_cubit.dart';
import 'package:pickforge/features/workbench/cubit/projects_state.dart';
import 'package:pickforge/features/workbench/view/project_file_explorer_panel.dart';
import 'package:pickforge/features/workbench/view/projects_chats_panel.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

class WorkbenchLeftPane extends StatelessWidget {
  const WorkbenchLeftPane({super.key});

  @override
  Widget build(BuildContext context) {
    final hasActiveProject = context.select<ProjectsCubit, bool>((cubit) {
      final state = cubit.state;
      return state is ProjectsReady && state.activeProjectRoot != null;
    });
    return Column(
      children: [
        const Expanded(
          flex: 3,
          child: ProjectsChatsPanel(),
        ),
        if (hasActiveProject) ...[
          const Divider(height: 1),
          const Expanded(
            flex: 2,
            child: SingleChildScrollView(
              child: ProjectFileExplorerPanel(),
            ),
          ),
        ],
        const _BrandLine(),
      ],
    );
  }
}

/// The brand bottom line from the desktop-shell recipe in
/// `branding-visual/APPLICATION-EXAMPLES.md` — mono, muted, hairline-topped —
/// plus the always-reachable settings entry point.
class _BrandLine extends StatelessWidget {
  const _BrandLine();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.xs / 2,
      ),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: PickforgeColors.hairline)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '© PICKFORGE · PICKFORGE.DEV · MIT',
              style: PickforgeText.eyebrow.copyWith(
                color: PickforgeColors.textLow,
                fontSize: 9,
              ),
            ),
          ),
          Tooltip(
            message: l10n.settingsTitle,
            child: InkWell(
              onTap: () => context.go(AppRoutes.settings),
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
              child: Padding(
                padding: const EdgeInsets.all(PickforgeSpacing.xs),
                child: Icon(
                  Icons.settings_outlined,
                  size: 14,
                  color: PickforgeColors.textMed,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:async';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/features/settings/cubit/settings_cubit.dart';
import 'package:pickforge/features/settings/widgets/settings_section.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/components/mono_eyebrow.dart';
import 'package:pickforge/shared/motion/pickforge_motion.dart';
import 'package:pickforge/shared/motion/reduce_motion.dart';
import 'package:pickforge/shared/theme/pickforge_colors.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';
import 'package:pickforge/shared/theme/pickforge_typography.dart';

/// Per-project context storage location picker. Home / Project-local / Custom,
/// with a custom-folder chooser, an inline repo-write warning for project-local
/// mode, and the absolute resolved context directory. A failed switch surfaces
/// the error inline (the override is never persisted on failure); a successful
/// switch that leaves data behind raises a copy-confirm dialog.
class ContextStorageSettings extends StatelessWidget {
  const ContextStorageSettings({
    required this.projectRoot,
    this.pickFolder = getDirectoryPath,
    super.key,
  });

  final String projectRoot;
  final Future<String?> Function() pickFolder;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return BlocConsumer<SettingsCubit, SettingsState>(
      listenWhen: (previous, current) =>
          previous.copyOffer != current.copyOffer && current.copyOffer != null,
      listener: (context, state) {
        final offer = state.copyOffer;
        if (offer != null) {
          unawaited(_promptCopy(context, offer));
        }
      },
      builder: (context, state) {
        final mode =
            state.contextStorageMode ?? ContextStorageMode.pickforgeHome;
        return SettingsSection(
          title: l10n.settingsContextStorage,
          children: [
            Text(
              l10n.settingsContextStorageHelper,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            SettingsField(
              label: l10n.settingsContextStorageLocation,
              child: SegmentedButton<ContextStorageMode>(
                key: const Key('context-storage-mode'),
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(
                    value: ContextStorageMode.pickforgeHome,
                    label: Text(l10n.settingsContextStorageHome),
                  ),
                  ButtonSegment(
                    value: ContextStorageMode.projectLocal,
                    label: Text(l10n.settingsContextStorageProjectLocal),
                  ),
                  ButtonSegment(
                    value: ContextStorageMode.customPath,
                    label: Text(l10n.settingsContextStorageCustom),
                  ),
                ],
                selected: {mode},
                onSelectionChanged: (selection) =>
                    _onModeChanged(context, selection.single, state),
              ),
            ),
            if (mode == ContextStorageMode.pickforgeHome)
              _Hint(text: l10n.settingsContextStorageHomeHint),
            if (mode == ContextStorageMode.projectLocal)
              _Warning(text: l10n.settingsContextStorageProjectLocalWarning),
            if (mode == ContextStorageMode.customPath)
              _CustomFolderField(
                projectRoot: projectRoot,
                customPath: state.contextStorageCustomPath,
                pickFolder: pickFolder,
              ),
            if (state.contextStorageError case final error?)
              _Warning(
                key: const Key('context-storage-error'),
                text: error,
                tone: _Tone.error,
              ),
            if (state.resolvedContextDir case final dir?)
              SettingsField(
                label: l10n.settingsContextStorageResolvedDir,
                alignment: CrossAxisAlignment.start,
                child: SelectableText(
                  dir,
                  style: PickforgeText.mono,
                ),
              ),
          ],
        );
      },
    );
  }

  void _onModeChanged(
    BuildContext context,
    ContextStorageMode mode,
    SettingsState state,
  ) {
    if (mode == state.contextStorageMode) return;
    final cubit = context.read<SettingsCubit>();
    switch (mode) {
      case ContextStorageMode.pickforgeHome:
        cubit
            .setContextStorageLocation(
              projectRoot,
              const ContextStorageLocation.pickforgeHome(),
            )
            .ignore();
      case ContextStorageMode.projectLocal:
        cubit
            .setContextStorageLocation(
              projectRoot,
              const ContextStorageLocation.projectLocal(),
            )
            .ignore();
      case ContextStorageMode.customPath:
        unawaited(_chooseCustom(context));
    }
  }

  Future<void> _chooseCustom(BuildContext context) async {
    final cubit = context.read<SettingsCubit>();
    final picked = await pickFolder();
    if (picked == null) return;
    await cubit.setContextStorageLocation(
      projectRoot,
      ContextStorageLocation.custom(picked),
    );
  }

  Future<void> _promptCopy(
    BuildContext context,
    ContextStorageCopyOffer offer,
  ) async {
    final cubit = context.read<SettingsCubit>();
    final confirmed = await showContextStorageCopyDialog(context, offer);
    if (confirmed ?? false) {
      await cubit.confirmCopy();
    } else {
      cubit.dismissCopyOffer();
    }
  }
}

class _CustomFolderField extends StatelessWidget {
  const _CustomFolderField({
    required this.projectRoot,
    required this.customPath,
    required this.pickFolder,
  });

  final String projectRoot;
  final String? customPath;
  final Future<String?> Function() pickFolder;

  bool get _isInsideRepo {
    final path = customPath;
    if (path == null) return false;
    return p.equals(path, projectRoot) || p.isWithin(projectRoot, path);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SettingsField(
      label: l10n.settingsContextStorageCustomFolder,
      alignment: CrossAxisAlignment.start,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            customPath ?? l10n.settingsContextStorageNoCustomFolder,
            style: customPath == null
                ? Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: PickforgeColors.textLow,
                    )
                : PickforgeText.mono,
          ),
          if (_isInsideRepo) ...[
            const SizedBox(height: PickforgeSpacing.sm),
            _Warning(
              key: const Key('context-storage-custom-inside-repo'),
              text: l10n.settingsContextStorageCustomInsideRepoWarning,
            ),
          ],
          const SizedBox(height: PickforgeSpacing.sm),
          OutlinedButton.icon(
            key: const Key('context-storage-choose-folder'),
            style: settingsCompactButtonStyle(),
            onPressed: () => unawaited(_choose(context)),
            icon: const Icon(Icons.folder_open, size: 16),
            label: Text(l10n.settingsContextStorageChooseFolder),
          ),
        ],
      ),
    );
  }

  Future<void> _choose(BuildContext context) async {
    final cubit = context.read<SettingsCubit>();
    final picked = await pickFolder();
    if (picked == null) return;
    await cubit.setContextStorageLocation(
      projectRoot,
      ContextStorageLocation.custom(picked),
    );
  }
}

enum _Tone { neutral, error }

class _Warning extends StatelessWidget {
  const _Warning({
    required this.text,
    this.tone = _Tone.neutral,
    super.key,
  });

  final String text;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final color =
        tone == _Tone.error ? PickforgeColors.error : PickforgeColors.warning;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          tone == _Tone.error
              ? Icons.error_outline
              : Icons.warning_amber_rounded,
          size: 16,
          color: color,
        ),
        const SizedBox(width: PickforgeSpacing.sm),
        Expanded(
          child: Text(
            text,
            style:
                Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: PickforgeColors.textMed,
          ),
    );
  }
}

/// Copy-on-switch confirmation. Quiet hairline dialog; the single ember lives
/// on the confirm action only. Honors reduced motion via [ReduceMotion].
Future<bool?> showContextStorageCopyDialog(
  BuildContext context,
  ContextStorageCopyOffer offer,
) {
  final l10n = AppLocalizations.of(context);
  final summary = _copySummary(l10n, offer.plan);
  return showGeneralDialog<bool>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    transitionDuration: ReduceMotion.duration(context, PickforgeMotion.fast),
    pageBuilder: (ctx, _, __) => Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Material(
          type: MaterialType.transparency,
          child: Container(
            decoration: BoxDecoration(
              color: PickforgeColors.surface2,
              border: Border.all(color: PickforgeColors.hairline),
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusLg),
            ),
            padding: const EdgeInsets.all(PickforgeSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                MonoEyebrow(l10n.settingsContextStorageCopyTitle, tick: true),
                const SizedBox(height: PickforgeSpacing.md),
                Text(
                  l10n.settingsContextStorageCopyMessage(summary),
                  style: Theme.of(ctx).textTheme.bodyMedium,
                ),
                const SizedBox(height: PickforgeSpacing.lg),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(ctx).pop(false),
                      child: Text(l10n.settingsContextStorageCopySkip),
                    ),
                    const SizedBox(width: PickforgeSpacing.sm),
                    FilledButton(
                      key: const Key('context-storage-copy-confirm'),
                      onPressed: () => Navigator.of(ctx).pop(true),
                      child: Text(l10n.settingsContextStorageCopyConfirm),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    ),
    transitionBuilder: (ctx, animation, _, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: PickforgeMotion.forge,
      );
      return FadeTransition(opacity: curved, child: child);
    },
  );
}

String _copySummary(AppLocalizations l10n, StorageCopyPlan plan) {
  final parts = <String>[
    if (plan.chatCount > 0)
      l10n.settingsContextStorageCopyChats(plan.chatCount),
    if (plan.runCount > 0) l10n.settingsContextStorageCopyRuns(plan.runCount),
    if (plan.pasteCount > 0)
      l10n.settingsContextStorageCopyPastes(plan.pasteCount),
    if (plan.skillCount > 0)
      l10n.settingsContextStorageCopySkills(plan.skillCount),
    if (plan.promptTemplateCount > 0)
      l10n.settingsContextStorageCopyPromptTemplates(plan.promptTemplateCount),
    if (plan.hasContextFiles) l10n.settingsContextStorageCopyContextFiles,
  ];
  return parts.join(' + ');
}

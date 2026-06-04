import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/context_attachment.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/emulator/process_runner.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/projects/git_status_service.dart';
import 'package:pickforge/core/projects/project_file_opener.dart';
import 'package:pickforge/core/projects/project_validator_runner.dart';
import 'package:pickforge/core/settings/project_settings_repository.dart';
import 'package:pickforge/core/skills/skill_store.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_cubit.dart';
import 'package:pickforge/features/emulator/cubit/emulator_session_state.dart';
import 'package:pickforge/features/emulator/cubit/run_logs_cubit.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_cubit.dart';
import 'package:pickforge/features/forge/cubit/context_attachments_state.dart';
import 'package:pickforge/features/forge/cubit/forge_cubit.dart';
import 'package:pickforge/features/forge/cubit/forge_state.dart';
import 'package:pickforge/features/forge/widgets/agent_picker.dart';
import 'package:pickforge/features/forge/widgets/skill_picker.dart';
import 'package:pickforge/l10n/generated/app_localizations.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

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

  static const int _largeContextBytes = 64 * 1024;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return BlocBuilder<ForgeCubit, ForgeState>(
      builder: (context, state) {
        final cubit = context.read<ForgeCubit>();
        final eligibleSelection = selection != null &&
            const ForgeEligibilityPolicy().canForge(selection!, projectRoot);
        final canForge = eligibleSelection && chatId != null;
        final showUserCodeHint = selection != null && !eligibleSelection;
        final attachmentState = _attachmentsStateFor(context);
        final attachments =
            attachmentState?.attachments ?? const <ContextAttachment>[];
        final runLogCount = _runLogCountFor(context);
        final deviceTarget = _deviceTargetFor(context);
        final forgeAction = (!canForge || state.launching)
            ? null
            : () => unawaited(
                  _confirmAndForge(
                    context,
                    cubit,
                    selection!,
                    projectRoot,
                    chatId!,
                    attachments,
                    attachmentState?.customNote ?? '',
                    deviceTarget.serial,
                    deviceTarget.platform,
                  ),
                );
        return CallbackShortcuts(
          bindings: {
            if (forgeAction != null) ...{
              const SingleActivator(LogicalKeyboardKey.enter, control: true):
                  forgeAction,
              const SingleActivator(LogicalKeyboardKey.enter, meta: true):
                  forgeAction,
            },
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SkillPicker(
                        value: state.skill,
                        onChanged: cubit.selectSkill,
                      ),
                      _SkillSourceButton(
                        source: _skillStore().resolveSkillSource(
                          state.skill,
                          projectRoot: projectRoot,
                        ),
                      ),
                      AgentPicker(
                        value: state.agentId,
                        onChanged: cubit.selectAgent,
                      ),
                      if (showUserCodeHint) ...[
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 240),
                          child: Text(
                            l10n.forgePickUserCodeHint,
                            overflow: TextOverflow.ellipsis,
                            style:
                                Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: Theme.of(context)
                                          .colorScheme
                                          .onSurfaceVariant,
                                    ),
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                      OutlinedButton.icon(
                        style: _forgeCompactOutlinedStyle(context),
                        onPressed: selection == null
                            ? null
                            : () => unawaited(
                                  _showPreview(
                                    context,
                                    cubit,
                                    selection!,
                                    projectRoot,
                                    attachments,
                                    attachmentState?.customNote ?? '',
                                    onForge: (!canForge || state.launching)
                                        ? null
                                        : (initialPromptOverride) =>
                                            _confirmAndForge(
                                              context,
                                              cubit,
                                              selection!,
                                              projectRoot,
                                              chatId!,
                                              attachments,
                                              attachmentState?.customNote ?? '',
                                              deviceTarget.serial,
                                              deviceTarget.platform,
                                              initialPromptOverride:
                                                  initialPromptOverride,
                                            ),
                                  ),
                                ),
                        icon: const Icon(Icons.article_outlined, size: 16),
                        label: Text(l10n.forgePreviewButton),
                      ),
                      const SizedBox(width: PickforgeSpacing.sm),
                      FilledButton.icon(
                        style: _forgeCompactFilledStyle(),
                        onPressed: forgeAction,
                        icon: const Icon(Icons.auto_fix_high, size: 16),
                        label: Text(l10n.forgeItButton),
                      ),
                      if (state.lastError case final error?)
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 240),
                          child: Text(
                            error,
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (selection != null ||
                    attachments.isNotEmpty ||
                    attachmentState?.lastBlockedReason != null) ...[
                  const SizedBox(height: PickforgeSpacing.sm),
                  _ContextTray(
                    selection: selection,
                    attachmentState: attachmentState,
                    runLogCount: runLogCount,
                    largeContextBytes: _largeContextBytes,
                  ),
                ],
                const SizedBox(height: PickforgeSpacing.sm),
                _GitChangesCard(projectRoot: projectRoot),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SkillSourceButton extends StatelessWidget {
  const _SkillSourceButton({required this.source});

  final SkillSource source;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return IconButton(
      tooltip: l10n.forgeSkillSourceTooltip,
      onPressed: () => unawaited(_showSkillSource(context, source)),
      icon: Icon(
        source.isProjectOverride
            ? Icons.folder_special_outlined
            : Icons.inventory_2_outlined,
        size: 18,
      ),
    );
  }
}

class _ForgeSurface extends StatelessWidget {
  const _ForgeSurface({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(PickforgeSpacing.sm),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.30),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.54),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: child,
    );
  }
}

class _ContextTag extends StatelessWidget {
  const _ContextTag({
    required this.label,
    this.icon,
    this.warning = false,
    this.onPressed,
    this.onDeleted,
    this.deleteTooltip,
    this.trailing,
  });

  final String label;
  final IconData? icon;
  final bool warning;
  final VoidCallback? onPressed;
  final VoidCallback? onDeleted;
  final String? deleteTooltip;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final accent = warning ? colorScheme.error : colorScheme.primary;
    final deleteTooltip = this.deleteTooltip ??
        MaterialLocalizations.of(context).closeButtonLabel;
    final content = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.sm,
        vertical: PickforgeSpacing.xs,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 15, color: warning ? accent : null),
            const SizedBox(width: PickforgeSpacing.xs),
          ],
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: warning ? accent : null,
                  ),
            ),
          ),
          if (onDeleted != null) ...[
            const SizedBox(width: PickforgeSpacing.xs),
            Tooltip(
              message: deleteTooltip,
              excludeFromSemantics: true,
              child: Semantics(
                container: true,
                button: true,
                label: deleteTooltip,
                child: ExcludeSemantics(
                  child: InkResponse(
                    radius: 12,
                    onTap: onDeleted,
                    child: Icon(Icons.close, size: 14, color: accent),
                  ),
                ),
              ),
            ),
          ],
          if (trailing != null) ...[
            const SizedBox(width: PickforgeSpacing.xs),
            trailing!,
          ],
        ],
      ),
    );
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 320),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
          onTap: onPressed,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: warning
                  ? colorScheme.errorContainer.withValues(alpha: 0.36)
                  : colorScheme.surfaceContainerHighest.withValues(alpha: 0.48),
              border: Border.all(
                color: warning
                    ? accent.withValues(alpha: 0.42)
                    : colorScheme.outlineVariant.withValues(alpha: 0.58),
              ),
              borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
            ),
            child: content,
          ),
        ),
      ),
    );
  }
}

class _TinyTagButton extends StatelessWidget {
  const _TinyTagButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      icon: Icon(icon, size: 14),
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints.tightFor(width: 24, height: 24),
      onPressed: onPressed,
    );
  }
}

ButtonStyle _forgeCompactOutlinedStyle(
  BuildContext context, {
  bool danger = false,
}) =>
    OutlinedButton.styleFrom(
      visualDensity: VisualDensity.compact,
      minimumSize: const Size(0, 32),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.sm,
      ),
      foregroundColor: danger ? Theme.of(context).colorScheme.error : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
    );

ButtonStyle _forgeCompactFilledStyle() => FilledButton.styleFrom(
      visualDensity: VisualDensity.compact,
      minimumSize: const Size(0, 32),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      padding: const EdgeInsets.symmetric(
        horizontal: PickforgeSpacing.md,
        vertical: PickforgeSpacing.sm,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
    );

class _GitChangesCard extends StatefulWidget {
  const _GitChangesCard({required this.projectRoot});

  final String projectRoot;

  @override
  State<_GitChangesCard> createState() => _GitChangesCardState();
}

class _GitChangesCardState extends State<_GitChangesCard> {
  ProjectValidatorRunResult? _validatorResult;
  bool _validatorRunning = false;

  @override
  Widget build(BuildContext context) {
    final service = _gitStatusServiceOrNull();
    if (service == null) return const SizedBox.shrink();
    final settings = _projectSettingsOrNull();
    final hotReload = _hotReloadReviewFor(context);
    final l10n = AppLocalizations.of(context);
    return FutureBuilder<_ProjectReviewData>(
      future: _loadProjectReviewData(
        service,
        settings,
        widget.projectRoot,
      ),
      builder: (context, snapshot) {
        final data = snapshot.data;
        final summary = data?.summary;
        if (summary == null || !summary.hasChanges) {
          return const SizedBox.shrink();
        }
        final validatorCommand = data?.validatorCommand;
        return _ForgeSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.forgeProjectChangesTitle,
                style: Theme.of(context).textTheme.labelMedium,
              ),
              const SizedBox(height: PickforgeSpacing.sm),
              Wrap(
                spacing: PickforgeSpacing.xs,
                runSpacing: PickforgeSpacing.xs,
                children: [
                  OutlinedButton.icon(
                    style: _forgeCompactOutlinedStyle(context),
                    onPressed: () => unawaited(
                      _copyGitDiff(context, service, widget.projectRoot),
                    ),
                    icon: const Icon(Icons.copy, size: 14),
                    label: Text(l10n.forgeCopyDiff),
                  ),
                  if (validatorCommand != null)
                    OutlinedButton.icon(
                      style: _forgeCompactOutlinedStyle(context),
                      onPressed: _validatorRunning
                          ? null
                          : () => unawaited(
                                _runValidator(validatorCommand),
                              ),
                      icon: const Icon(Icons.fact_check_outlined, size: 14),
                      label: Text(l10n.forgeRunValidator),
                    ),
                  OutlinedButton.icon(
                    style: _forgeCompactOutlinedStyle(context),
                    onPressed: () => unawaited(
                      _showDiscardInstructions(context),
                    ),
                    icon: const Icon(Icons.undo, size: 14),
                    label: Text(l10n.forgeDiscardInstructions),
                  ),
                ],
              ),
              if (summary.branchName case final branch?)
                Text(l10n.forgeDirtyWorktreeBranch(branch)),
              Text(
                l10n.forgeChangedFiles(summary.changedFiles.length),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              for (final file in summary.changedFiles.take(5))
                _ChangedFileRow(projectRoot: widget.projectRoot, file: file),
              if (summary.stat.trim().isNotEmpty) ...[
                const SizedBox(height: PickforgeSpacing.xs),
                Text(
                  summary.stat,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (hotReload != null) ...[
                const SizedBox(height: PickforgeSpacing.sm),
                _HotReloadResultView(review: hotReload),
              ],
              if (_validatorRunning || _validatorResult != null) ...[
                const SizedBox(height: PickforgeSpacing.sm),
                _ValidatorResultView(
                  running: _validatorRunning,
                  result: _validatorResult,
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Future<void> _runValidator(String command) async {
    final runner = _projectValidatorRunnerOrNull();
    if (runner == null) return;
    setState(() {
      _validatorRunning = true;
      _validatorResult = null;
    });
    final result = await runner.run(
      projectRoot: widget.projectRoot,
      command: command,
    );
    if (!mounted) return;
    setState(() {
      _validatorRunning = false;
      _validatorResult = result;
    });
  }
}

class _ProjectReviewData {
  const _ProjectReviewData({
    required this.summary,
    required this.validatorCommand,
  });

  final GitDiffSummary? summary;
  final String? validatorCommand;
}

Future<_ProjectReviewData> _loadProjectReviewData(
  GitStatusService service,
  ProjectSettingsRepository? settings,
  String projectRoot,
) async {
  final results = await Future.wait<Object?>([
    service.diffSummary(projectRoot),
    if (settings != null)
      settings.getValidatorCommand(projectRoot)
    else
      Future<String?>.value(),
  ]);
  return _ProjectReviewData(
    summary: results[0] as GitDiffSummary?,
    validatorCommand: results[1] as String?,
  );
}

class _HotReloadReview {
  const _HotReloadReview({
    required this.success,
    required this.fullRestart,
    required this.durationMs,
    this.hint,
  });

  final bool success;
  final bool fullRestart;
  final int? durationMs;
  final String? hint;

  String title(AppLocalizations l10n) {
    final duration = durationMs?.toString() ?? 'n/a';
    if (fullRestart) {
      return success
          ? l10n.forgeHotRestartPassed(duration)
          : l10n.forgeHotRestartFailed(duration);
    }
    return success
        ? l10n.forgeHotReloadPassed(duration)
        : l10n.forgeHotReloadFailed(duration);
  }
}

class _HotReloadResultView extends StatelessWidget {
  const _HotReloadResultView({required this.review});

  final _HotReloadReview review;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final hint = review.hint?.trim();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(PickforgeSpacing.sm),
      decoration: BoxDecoration(
        color: review.success
            ? colorScheme.primaryContainer.withValues(alpha: 0.24)
            : colorScheme.errorContainer.withValues(alpha: 0.28),
        border: Border.all(
          color: review.success
              ? colorScheme.primary.withValues(alpha: 0.28)
              : colorScheme.error.withValues(alpha: 0.34),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            review.title(l10n),
            style: theme.textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: review.success ? colorScheme.primary : colorScheme.error,
            ),
          ),
          if (hint != null && hint.isNotEmpty) ...[
            const SizedBox(height: PickforgeSpacing.xs),
            SelectableText(
              hint,
              maxLines: 3,
              style: theme.textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }
}

class _ValidatorResultView extends StatelessWidget {
  const _ValidatorResultView({
    required this.running,
    required this.result,
  });

  final bool running;
  final ProjectValidatorRunResult? result;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    if (running) {
      return Row(
        children: [
          const SizedBox.square(
            dimension: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: PickforgeSpacing.sm),
          Text(l10n.forgeValidatorRunning),
        ],
      );
    }
    final result = this.result;
    if (result == null) return const SizedBox.shrink();
    final output = _truncateValidatorOutput(result.combinedOutput);
    final statusText = result.passed
        ? l10n.forgeValidatorPassed
        : l10n.forgeValidatorFailed(result.exitCode?.toString() ?? 'start');
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(PickforgeSpacing.sm),
      decoration: BoxDecoration(
        color: result.passed
            ? colorScheme.primaryContainer.withValues(alpha: 0.24)
            : colorScheme.errorContainer.withValues(alpha: 0.28),
        border: Border.all(
          color: result.passed
              ? colorScheme.primary.withValues(alpha: 0.28)
              : colorScheme.error.withValues(alpha: 0.34),
        ),
        borderRadius: BorderRadius.circular(PickforgeSpacing.radiusSm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            statusText,
            style: theme.textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w700,
              color: result.passed ? colorScheme.primary : colorScheme.error,
            ),
          ),
          if (output.isNotEmpty) ...[
            const SizedBox(height: PickforgeSpacing.xs),
            SelectableText(
              output,
              maxLines: 6,
              style: theme.textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }
}

String _truncateValidatorOutput(String output) {
  const max = 1200;
  final trimmed = output.trim();
  if (trimmed.length <= max) return trimmed;
  return '${trimmed.substring(0, max)}...';
}

class _ChangedFileRow extends StatelessWidget {
  const _ChangedFileRow({required this.projectRoot, required this.file});

  final String projectRoot;
  final String file;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      children: [
        Expanded(
          child: Text(
            '• $file',
            overflow: TextOverflow.ellipsis,
          ),
        ),
        _TinyTagButton(
          tooltip: l10n.forgeOpenChangedFile,
          icon: Icons.open_in_new,
          onPressed: () => unawaited(
            _openChangedFile(context, projectRoot, file),
          ),
        ),
      ],
    );
  }
}

class _ContextTray extends StatelessWidget {
  const _ContextTray({
    required this.selection,
    required this.attachmentState,
    required this.runLogCount,
    required this.largeContextBytes,
  });

  final SelectedWidget? selection;
  final ContextAttachmentsState? attachmentState;
  final int runLogCount;
  final int largeContextBytes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cubit = _attachmentsCubitOrNull(context);
    final attachments =
        attachmentState?.attachments ?? const <ContextAttachment>[];
    final totalBytes = attachmentState?.totalBytes ?? 0;
    return Align(
      alignment: Alignment.centerLeft,
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            l10n.forgeContextAttachments,
            style: Theme.of(context).textTheme.labelSmall,
          ),
          if (selection case final selected?)
            _ContextTag(
              icon: Icons.widgets_outlined,
              label: l10n.forgeSelectedWidgetChip(selected.node.className),
            ),
          if (selection?.screenshotPath case final path?)
            _ContextTag(
              icon: Icons.screenshot_monitor_outlined,
              label: l10n.forgeScreenshotChip(_basename(path)),
            ),
          if (selection?.adbScreenshotPath case final path?)
            _ContextTag(
              icon: Icons.phone_android_outlined,
              label: l10n.forgeDeviceScreenshotChip(_basename(path)),
            ),
          if (runLogCount > 0)
            _ContextTag(
              icon: Icons.receipt_long_outlined,
              label: l10n.forgeRunLogsChip(runLogCount),
            ),
          if (attachmentState?.customNote.isNotEmpty ?? false)
            _ContextTag(
              icon: Icons.sticky_note_2_outlined,
              label: l10n.forgeCustomNoteChip,
              onPressed: cubit == null
                  ? null
                  : () => unawaited(
                        _editCustomNote(
                          context,
                          cubit,
                          attachmentState!.customNote,
                        ),
                      ),
              onDeleted: cubit == null ? null : () => cubit.setCustomNote(''),
              deleteTooltip: l10n.forgeRemoveCustomNote,
            )
          else
            OutlinedButton.icon(
              style: _forgeCompactOutlinedStyle(context),
              onPressed: cubit == null
                  ? null
                  : () => unawaited(_editCustomNote(context, cubit, '')),
              icon: const Icon(Icons.add_comment_outlined, size: 16),
              label: Text(l10n.forgeAddCustomNote),
            ),
          for (var i = 0; i < attachments.length; i++)
            _AttachmentChip(
              attachment: attachments[i],
              canMoveUp: i > 0,
              canMoveDown: i < attachments.length - 1,
              cubit: cubit,
            ),
          if (totalBytes > largeContextBytes)
            _ContextWarning(
              text: l10n.forgeAttachmentSizeWarning(_formatBytes(totalBytes)),
            ),
          if (attachmentState?.lastBlockedReason case final reason?)
            _ContextWarning(
              text: l10n.forgeBlockedAttachment(
                attachmentState!.lastBlockedPath ?? '',
                reason,
              ),
              onDismiss: cubit?.clearBlockedNotice,
            ),
        ],
      ),
    );
  }
}

class _AttachmentChip extends StatelessWidget {
  const _AttachmentChip({
    required this.attachment,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.cubit,
  });

  final ContextAttachment attachment;
  final bool canMoveUp;
  final bool canMoveDown;
  final ContextAttachmentsCubit? cubit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final label =
        '${attachment.relativePath} (${_formatBytes(attachment.byteLength)})';
    return _ContextTag(
      icon: Icons.attach_file,
      label: label,
      onDeleted: cubit == null ? null : () => cubit!.remove(attachment.path),
      deleteTooltip: l10n.forgeRemoveAttachment,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _TinyTagButton(
            tooltip: l10n.forgeMoveAttachmentUp,
            icon: Icons.arrow_upward,
            onPressed: canMoveUp && cubit != null
                ? () => cubit!.moveUp(attachment.path)
                : null,
          ),
          _TinyTagButton(
            tooltip: l10n.forgeMoveAttachmentDown,
            icon: Icons.arrow_downward,
            onPressed: canMoveDown && cubit != null
                ? () => cubit!.moveDown(attachment.path)
                : null,
          ),
        ],
      ),
    );
  }
}

class _ContextWarning extends StatelessWidget {
  const _ContextWarning({required this.text, this.onDismiss});

  final String text;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return _ContextTag(
      icon: Icons.warning_amber,
      label: text,
      warning: true,
      onDeleted: onDismiss,
      deleteTooltip: l10n.forgeDismissContextWarning,
    );
  }
}

ContextAttachmentsState? _attachmentsStateFor(BuildContext context) {
  try {
    return context.watch<ContextAttachmentsCubit>().state;
  } on ProviderNotFoundException {
    return null;
  }
}

int _runLogCountFor(BuildContext context) {
  try {
    return context.watch<RunLogsCubit>().state.entries.length;
  } on ProviderNotFoundException {
    return 0;
  }
}

({String? serial, String? platform}) _deviceTargetFor(BuildContext context) {
  try {
    return switch (context.watch<EmulatorSessionCubit>().state) {
      Idle(:final avd, :final serial) => (
          serial: serial,
          platform: avd.platform,
        ),
      Running(:final avd, :final serial) => (
          serial: serial,
          platform: avd?.platform,
        ),
      Reconnecting(:final avd, :final serial) => (
          serial: serial,
          platform: avd.platform,
        ),
      EmulatorError(:final avd, :final serial) => (
          serial: serial,
          platform: avd?.platform,
        ),
      _ => (serial: null, platform: null),
    };
  } on ProviderNotFoundException {
    return (serial: null, platform: null);
  }
}

_HotReloadReview? _hotReloadReviewFor(BuildContext context) {
  try {
    return switch (context.watch<EmulatorSessionCubit>().state) {
      Running(
        :final lastReloadAt,
        :final lastReloadSucceeded,
        :final lastReloadFullRestart,
        :final lastReloadDurationMs,
        :final lastReloadHint,
      )
          when lastReloadAt != null && lastReloadSucceeded != null =>
        _HotReloadReview(
          success: lastReloadSucceeded,
          fullRestart: lastReloadFullRestart,
          durationMs: lastReloadDurationMs,
          hint: lastReloadHint,
        ),
      _ => null,
    };
  } on ProviderNotFoundException {
    return null;
  }
}

ContextAttachmentsCubit? _attachmentsCubitOrNull(BuildContext context) {
  try {
    return context.read<ContextAttachmentsCubit>();
  } on ProviderNotFoundException {
    return null;
  }
}

GitStatusService? _gitStatusServiceOrNull() {
  try {
    return GitStatusService(getIt<ProcessRunner>());
  } on Object {
    return null;
  }
}

ProjectFileOpener? _projectFileOpenerOrNull() {
  try {
    return ProjectFileOpener(runner: getIt<ProcessRunner>());
  } on Object {
    return null;
  }
}

ProjectSettingsRepository? _projectSettingsOrNull() {
  try {
    return getIt<ProjectSettingsRepository>();
  } on Object {
    return null;
  }
}

ProjectValidatorRunner? _projectValidatorRunnerOrNull() {
  try {
    return ProjectValidatorRunner(runner: getIt<ProcessRunner>());
  } on Object {
    return null;
  }
}

SkillStore _skillStore() {
  if (getIt.isRegistered<SkillStore>()) return getIt<SkillStore>();
  return SkillStore();
}

Future<void> _showSkillSource(
  BuildContext context,
  SkillSource source,
) {
  final l10n = AppLocalizations.of(context);
  final label = source.isProjectOverride
      ? l10n.forgeSkillSourceProjectOverride
      : l10n.forgeSkillSourceBundled;
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.forgeSkillSourceTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label),
          const SizedBox(height: 8),
          SelectableText(source.location),
        ],
      ),
      actions: [
        OutlinedButton(
          style: _forgeCompactOutlinedStyle(context),
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    ),
  );
}

Future<void> _copyGitDiff(
  BuildContext context,
  GitStatusService service,
  String projectRoot,
) async {
  final l10n = AppLocalizations.of(context);
  final diff = await service.diff(projectRoot);
  if (!context.mounted || diff == null) return;
  await Clipboard.setData(ClipboardData(text: diff));
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(l10n.forgeDiffCopied)),
  );
}

Future<void> _openChangedFile(
  BuildContext context,
  String projectRoot,
  String file,
) async {
  final opener = _projectFileOpenerOrNull();
  if (opener == null) return;
  final l10n = AppLocalizations.of(context);
  final path =
      p.isAbsolute(file) ? file : p.normalize(p.join(projectRoot, file));
  try {
    await opener.open(path);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.forgeChangedFileOpened(_basename(file)))),
    );
  } on Object {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.forgeChangedFileOpenFailed(_basename(file)))),
    );
  }
}

Future<void> _showDiscardInstructions(BuildContext context) {
  final l10n = AppLocalizations.of(context);
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.forgeDiscardInstructionsTitle),
      content: SelectableText(l10n.forgeDiscardInstructionsMessage),
      actions: [
        OutlinedButton(
          style: _forgeCompactOutlinedStyle(context),
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    ),
  );
}

Future<void> _editCustomNote(
  BuildContext context,
  ContextAttachmentsCubit cubit,
  String initialValue,
) {
  final l10n = AppLocalizations.of(context);
  final controller = TextEditingController(text: initialValue);
  return showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.forgeCustomNoteTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        maxLines: 5,
        decoration: InputDecoration(
          labelText: l10n.forgeCustomNoteLabel,
          border: const OutlineInputBorder(),
        ),
      ),
      actions: [
        OutlinedButton(
          style: _forgeCompactOutlinedStyle(dialogContext),
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(
            MaterialLocalizations.of(dialogContext).cancelButtonLabel,
          ),
        ),
        FilledButton(
          onPressed: () {
            cubit.setCustomNote(controller.text);
            Navigator.of(dialogContext).pop();
          },
          child: Text(l10n.forgeCustomNoteSave),
        ),
      ],
    ),
  ).whenComplete(controller.dispose);
}

String _basename(String path) {
  final normalized = path.replaceAll(r'\', '/');
  final slash = normalized.lastIndexOf('/');
  return slash == -1 ? normalized : normalized.substring(slash + 1);
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  final kb = bytes / 1024;
  if (kb < 1024) return '${kb.toStringAsFixed(kb < 10 ? 1 : 0)} KB';
  final mb = kb / 1024;
  return '${mb.toStringAsFixed(mb < 10 ? 1 : 0)} MB';
}

Future<void> _showPreview(
  BuildContext context,
  ForgeCubit cubit,
  SelectedWidget selection,
  String projectRoot,
  List<ContextAttachment> attachments,
  String customNote, {
  Future<void> Function(String initialPromptOverride)? onForge,
}) {
  final l10n = AppLocalizations.of(context);
  String? editedInitialPrompt;
  final preview = cubit.preview(
    selection: selection,
    projectRoot: projectRoot,
    attachmentPaths: [for (final attachment in attachments) attachment.path],
    customNote: customNote,
  );
  return showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.forgePreviewTitle),
      content: SizedBox(
        width: 720,
        child: FutureBuilder(
          future: preview,
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              if (snapshot.hasError) {
                return SelectableText(snapshot.error.toString());
              }
              return const SizedBox(
                height: 120,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: LinearProgressIndicator(minHeight: 2),
                ),
              );
            }
            final data = snapshot.data!;
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.forgeFinalInstructionLabel),
                  const SizedBox(height: PickforgeSpacing.xs),
                  TextFormField(
                    initialValue: data.initialPrompt,
                    minLines: 5,
                    maxLines: 10,
                    decoration: const InputDecoration(
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (value) => editedInitialPrompt = value,
                  ),
                  if (onForge != null) ...[
                    const SizedBox(height: PickforgeSpacing.sm),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton(
                        onPressed: () {
                          final prompt =
                              editedInitialPrompt ?? data.initialPrompt;
                          Navigator.of(context).pop();
                          unawaited(onForge(prompt));
                        },
                        child: Text(l10n.forgeForgeEditedInstruction),
                      ),
                    ),
                  ],
                  const SizedBox(height: PickforgeSpacing.md),
                  SelectableText(
                    [
                      '# Skill',
                      data.skillMarkdown,
                      '# Widget Context',
                      data.widgetContextMarkdown,
                    ].join('\n\n'),
                  ),
                ],
              ),
            );
          },
        ),
      ),
      actions: [
        OutlinedButton(
          style: _forgeCompactOutlinedStyle(context),
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    ),
  );
}

Future<void> _confirmAndForge(
  BuildContext context,
  ForgeCubit cubit,
  SelectedWidget selection,
  String projectRoot,
  String chatId,
  List<ContextAttachment> attachments,
  String customNote,
  String? deviceSerial,
  String? devicePlatform, {
  String? initialPromptOverride,
}) async {
  if (!await _confirmDirtyWorktree(context, projectRoot)) return;
  await cubit.forge(
    selection: selection,
    projectRoot: projectRoot,
    chatId: chatId,
    attachmentPaths: [for (final attachment in attachments) attachment.path],
    customNote: customNote,
    deviceSerial: deviceSerial,
    devicePlatform: devicePlatform,
    initialPromptOverride: initialPromptOverride,
  );
}

Future<bool> _confirmDirtyWorktree(
  BuildContext context,
  String projectRoot,
) async {
  final service = GitStatusService(getIt<ProcessRunner>());
  final status = await service.status(projectRoot);
  if (!context.mounted || !status.isRepository || !status.isDirty) return true;
  final l10n = AppLocalizations.of(context);
  final action = await showDialog<_DirtyWorktreeAction>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(l10n.forgeDirtyWorktreeTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (status.branchName case final branch?)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(l10n.forgeDirtyWorktreeBranch(branch)),
            ),
          Text(
            l10n.forgeDirtyWorktreeMessage(
              status.staged,
              status.unstaged,
              status.untracked,
            ),
          ),
        ],
      ),
      actions: [
        OutlinedButton(
          style: _forgeCompactOutlinedStyle(context),
          onPressed: () => Navigator.of(context).pop(_DirtyWorktreeAction.stop),
          child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
        ),
        if (status.staged > 0 || status.unstaged > 0)
          OutlinedButton(
            style: _forgeCompactOutlinedStyle(context),
            onPressed: () =>
                Navigator.of(context).pop(_DirtyWorktreeAction.checkpoint),
            child: Text(l10n.forgeDirtyWorktreeCheckpoint),
          ),
        FilledButton(
          onPressed: () =>
              Navigator.of(context).pop(_DirtyWorktreeAction.continueWithout),
          child: Text(l10n.forgeDirtyWorktreeContinue),
        ),
      ],
    ),
  );
  if (action == _DirtyWorktreeAction.continueWithout) return true;
  if (action != _DirtyWorktreeAction.checkpoint) return false;
  final result = await service.createCheckpointCommit(projectRoot);
  if (!context.mounted) return false;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(
        result.created
            ? l10n.forgeCheckpointCreated(result.commitHash ?? 'HEAD')
            : l10n.forgeCheckpointFailed,
      ),
    ),
  );
  return result.created;
}

enum _DirtyWorktreeAction { stop, checkpoint, continueWithout }

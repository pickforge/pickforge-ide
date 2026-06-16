import 'package:pickforge/core/targets/target_capability.dart';

/// A higher-level, framework-agnostic agent workflow offered for a selected
/// target. Which workflows are available depends on the target's capabilities.
enum TargetWorkflow {
  explainUi,
  fixUi,
  improveUi,
  generateTests,
  compareScreenshotAfterReload,
  runLogsTriage,
}

extension TargetWorkflowLabel on TargetWorkflow {
  /// The user-facing label.
  String get label => switch (this) {
        TargetWorkflow.explainUi => 'Explain selected UI',
        TargetWorkflow.fixUi => 'Fix selected UI',
        TargetWorkflow.improveUi => 'Improve selected UI',
        TargetWorkflow.generateTests => 'Generate tests for selected UI',
        TargetWorkflow.compareScreenshotAfterReload =>
          'Compare screenshot after reload',
        TargetWorkflow.runLogsTriage => 'Run logs triage',
      };
}

/// How trustworthy the source context is for a target — drives prompt language
/// so agents don't overstate certainty.
enum TargetSourceContextTier {
  /// Exact widget/element → source mapping (Flutter's VM Service inspector).
  deepSourceMapping,

  /// A selection is inspectable, but source files are likely-match search
  /// results, not exact mappings (React Native, native Android).
  bestEffortHints,

  /// Only screenshots and/or logs are available; no element selection.
  screenshotLogsOnly,

  /// Nothing beyond detection.
  none,
}

/// Maps an adapter's [TargetCapabilities] to the agent workflows it can offer
/// and the honesty tier of its source context. Pure and capability-driven.
class TargetWorkflowPolicy {
  const TargetWorkflowPolicy();

  Set<TargetWorkflow> availableWorkflows(TargetCapabilities capabilities) {
    final workflows = <TargetWorkflow>{};
    if (capabilities.has(TargetCapability.inspectSelection)) {
      workflows
        ..add(TargetWorkflow.explainUi)
        ..add(TargetWorkflow.fixUi)
        ..add(TargetWorkflow.improveUi)
        ..add(TargetWorkflow.generateTests);
    }
    if (capabilities.has(TargetCapability.hotReload) &&
        capabilities.has(TargetCapability.captureScreenshot)) {
      workflows.add(TargetWorkflow.compareScreenshotAfterReload);
    }
    if (capabilities.has(TargetCapability.streamLogs)) {
      workflows.add(TargetWorkflow.runLogsTriage);
    }
    return workflows;
  }

  TargetSourceContextTier sourceContextTier(TargetCapabilities capabilities) {
    if (capabilities.has(TargetCapability.mapSelectionToSource)) {
      return TargetSourceContextTier.deepSourceMapping;
    }
    if (capabilities.has(TargetCapability.inspectSelection)) {
      return TargetSourceContextTier.bestEffortHints;
    }
    if (capabilities.has(TargetCapability.captureScreenshot) ||
        capabilities.has(TargetCapability.streamLogs)) {
      return TargetSourceContextTier.screenshotLogsOnly;
    }
    return TargetSourceContextTier.none;
  }

  /// Prompt language reminding the agent how far to trust the source context.
  String certaintyGuidance(TargetSourceContextTier tier) => switch (tier) {
        TargetSourceContextTier.deepSourceMapping =>
          'The selection maps to an exact source location; you may edit it '
              'directly.',
        TargetSourceContextTier.bestEffortHints =>
          'Source files are best-effort search matches, NOT exact mappings — '
              'confirm before editing and prefer the highest-confidence hint.',
        TargetSourceContextTier.screenshotLogsOnly =>
          'No element selection is available — reason only from the screenshot '
              'and logs, and do not claim a specific source location.',
        TargetSourceContextTier.none =>
          'Only project detection is available for this target.',
      };
}

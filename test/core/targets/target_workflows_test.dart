import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/generic_project_adapter.dart';
import 'package:pickforge/core/targets/native_android/native_android_target_adapter.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_workflows.dart';

TargetCapabilities _caps(Set<TargetCapability> values) =>
    TargetCapabilities(values);

void main() {
  const policy = TargetWorkflowPolicy();

  test('Flutter (deep mapping) offers every workflow', () {
    final caps = const FlutterTargetAdapter().capabilities;
    expect(
      policy.sourceContextTier(caps),
      TargetSourceContextTier.deepSourceMapping,
    );
    expect(policy.availableWorkflows(caps), {
      TargetWorkflow.explainUi,
      TargetWorkflow.fixUi,
      TargetWorkflow.improveUi,
      TargetWorkflow.generateTests,
      TargetWorkflow.compareScreenshotAfterReload,
      TargetWorkflow.runLogsTriage,
    });
  });

  test('native Android is best-effort, no screenshot-after-reload', () {
    final caps = const NativeAndroidTargetAdapter().capabilities;
    expect(
      policy.sourceContextTier(caps),
      TargetSourceContextTier.bestEffortHints,
    );
    final workflows = policy.availableWorkflows(caps);
    expect(workflows, contains(TargetWorkflow.explainUi));
    expect(workflows, contains(TargetWorkflow.runLogsTriage));
    // No hotReload → no compare-after-reload.
    expect(
      workflows.contains(TargetWorkflow.compareScreenshotAfterReload),
      isFalse,
    );
  });

  test('screenshot/logs-only target offers just logs triage', () {
    final caps = _caps({
      TargetCapability.detect,
      TargetCapability.launch,
      TargetCapability.captureScreenshot,
      TargetCapability.streamLogs,
    });
    expect(
      policy.sourceContextTier(caps),
      TargetSourceContextTier.screenshotLogsOnly,
    );
    expect(policy.availableWorkflows(caps), {TargetWorkflow.runLogsTriage});
  });

  test('a detect-only target (generic) offers no workflows', () {
    final caps = const GenericProjectAdapter().capabilities;
    expect(policy.sourceContextTier(caps), TargetSourceContextTier.none);
    expect(policy.availableWorkflows(caps), isEmpty);
  });

  test('certainty guidance is honest per tier', () {
    expect(
      policy.certaintyGuidance(TargetSourceContextTier.deepSourceMapping),
      contains('exact'),
    );
    expect(
      policy.certaintyGuidance(TargetSourceContextTier.bestEffortHints),
      contains('NOT exact'),
    );
    expect(
      policy.certaintyGuidance(TargetSourceContextTier.screenshotLogsOnly),
      contains('do not claim'),
    );
    expect(
      policy.certaintyGuidance(TargetSourceContextTier.none),
      contains('detection'),
    );
  });

  test('support level badges map from capabilities', () {
    final flutter = const FlutterTargetAdapter().capabilities;
    expect(policy.supportLevel(flutter), TargetSupportLevel.deep);
    expect(policy.supportLevel(flutter).label, 'Deep support');

    final android = const NativeAndroidTargetAdapter().capabilities;
    expect(policy.supportLevel(android), TargetSupportLevel.useful);

    final runOnly = _caps({
      TargetCapability.detect,
      TargetCapability.launch,
      TargetCapability.captureScreenshot,
    });
    expect(policy.supportLevel(runOnly), TargetSupportLevel.experimental);

    final generic = const GenericProjectAdapter().capabilities;
    expect(policy.supportLevel(generic), TargetSupportLevel.manualOnly);
    expect(policy.supportLevel(generic).label, 'Manual-only');
  });

  test('workflow labels are user-facing', () {
    expect(TargetWorkflow.explainUi.label, 'Explain selected UI');
    expect(
      TargetWorkflow.compareScreenshotAfterReload.label,
      'Compare screenshot after reload',
    );
  });
}

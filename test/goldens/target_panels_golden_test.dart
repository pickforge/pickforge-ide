import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/flutter_target_adapter.dart';
import 'package:pickforge/core/targets/native_android/native_android_target_adapter.dart';
import 'package:pickforge/core/targets/target_workflows.dart';
import 'package:pickforge/features/workbench/view/adapter_doctor_panel.dart';
import 'package:pickforge/features/workbench/view/target_summary_panel.dart';
import 'package:pickforge/shared/theme/pickforge_spacing.dart';

import '../support/golden_test_harness.dart';

void main() {
  setUpAll(loadGoldenFonts);

  testWidgets(
    'target summary and doctor panels match golden',
    (tester) async {
      const key = ValueKey('target-panels-golden');
      await pumpGoldenSurface(
        tester,
        boundaryKey: key,
        size: const Size(760, 820),
        child: const _Panels(),
      );
      await expectGolden(key, 'target_panels');
    },
    skip: skipGoldenPlatform,
  );
}

class _Panels extends StatelessWidget {
  const _Panels();

  @override
  Widget build(BuildContext context) {
    const policy = TargetWorkflowPolicy();
    final flutter = const FlutterTargetAdapter().capabilities;
    final android = const NativeAndroidTargetAdapter().capabilities;
    return Padding(
      padding: const EdgeInsets.all(PickforgeSpacing.xxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TargetSummaryPanel(
            displayName: 'Flutter',
            supportLevel: policy.supportLevel(flutter),
            capabilities: flutter,
            workflows: policy.availableWorkflows(flutter),
          ),
          const SizedBox(height: PickforgeSpacing.lg),
          TargetSummaryPanel(
            displayName: 'React Native (Android)',
            supportLevel: policy.supportLevel(android),
            capabilities: android,
            workflows: policy.availableWorkflows(android),
          ),
          const SizedBox(height: PickforgeSpacing.lg),
          const AdapterDoctorPanel(
            checks: [
              DoctorCheck(label: 'Flutter VM Service', status: DoctorStatus.ok),
              DoctorCheck(label: 'ADB', status: DoctorStatus.ok),
              DoctorCheck(
                label: 'Xcode',
                status: DoctorStatus.missing,
                detail: 'macOS only',
              ),
              DoctorCheck(label: 'Node / npm', status: DoctorStatus.ok),
            ],
          ),
        ],
      ),
    );
  }
}

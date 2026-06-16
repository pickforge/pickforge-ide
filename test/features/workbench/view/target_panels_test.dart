import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/target_capability.dart';
import 'package:pickforge/core/targets/target_workflows.dart';
import 'package:pickforge/features/workbench/view/adapter_doctor_panel.dart';
import 'package:pickforge/features/workbench/view/target_summary_panel.dart';
import 'package:pickforge/features/workbench/view/target_support_badge.dart';

Future<void> _pump(WidgetTester tester, Widget child) {
  return tester.pumpWidget(
    MaterialApp(home: Scaffold(body: child)),
  );
}

void main() {
  testWidgets('TargetSummaryPanel shows name, badge and workflow chips',
      (tester) async {
    await _pump(
      tester,
      const TargetSummaryPanel(
        displayName: 'React Native (Android)',
        supportLevel: TargetSupportLevel.useful,
        capabilities: TargetCapabilities({
          TargetCapability.launch,
          TargetCapability.streamLogs,
        }),
        workflows: {TargetWorkflow.explainUi, TargetWorkflow.runLogsTriage},
      ),
    );
    expect(find.text('React Native (Android)'), findsOneWidget);
    expect(find.byType(TargetSupportBadge), findsOneWidget);
    // Capability badges render (lit or muted) for every operation.
    expect(find.text('RUN'), findsOneWidget);
    expect(find.text('SOURCE MAP'), findsOneWidget);
    expect(find.text('Explain selected UI'), findsOneWidget);
    expect(find.text('Run logs triage'), findsOneWidget);
  });

  testWidgets('TargetSummaryPanel notes when there are no workflows',
      (tester) async {
    await _pump(
      tester,
      const TargetSummaryPanel(
        displayName: 'Generic project',
        supportLevel: TargetSupportLevel.manualOnly,
        capabilities: TargetCapabilities.none,
        workflows: {},
      ),
    );
    expect(
      find.text('No selection workflows for this target.'),
      findsOneWidget,
    );
  });

  testWidgets('AdapterDoctorPanel renders a status pill per check',
      (tester) async {
    await _pump(
      tester,
      const AdapterDoctorPanel(
        checks: [
          DoctorCheck(label: 'ADB', status: DoctorStatus.ok),
          DoctorCheck(
            label: 'Xcode',
            status: DoctorStatus.missing,
            detail: 'macOS only',
          ),
        ],
      ),
    );
    expect(find.text('ADB'), findsOneWidget);
    expect(find.text('Xcode'), findsOneWidget);
    expect(find.text('macOS only'), findsOneWidget);
    // StatusPill uppercases the status label.
    expect(find.text('OK'), findsOneWidget);
    expect(find.text('MISSING'), findsOneWidget);
  });
}

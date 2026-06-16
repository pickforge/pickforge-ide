import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/target_workflows.dart';
import 'package:pickforge/features/workbench/view/target_support_badge.dart';
import 'package:pickforge/shared/components/status_pill.dart';

void main() {
  Future<void> pump(WidgetTester tester, TargetSupportLevel level) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: Center(child: TargetSupportBadge(level: level))),
      ),
    );
  }

  testWidgets('renders the support-level label as a StatusPill',
      (tester) async {
    await pump(tester, TargetSupportLevel.deep);
    expect(find.byType(StatusPill), findsOneWidget);
    // StatusPill uppercases its label.
    expect(find.text('DEEP SUPPORT'), findsOneWidget);
  });

  testWidgets('maps each support level to a distinct intent', (tester) async {
    final intents = <StatusIntent>{};
    for (final level in TargetSupportLevel.values) {
      await pump(tester, level);
      intents.add(tester.widget<StatusPill>(find.byType(StatusPill)).intent);
    }
    // deep/useful/experimental/manual-only map to four distinct intents.
    expect(intents, hasLength(TargetSupportLevel.values.length));
  });

  testWidgets('experimental uses the warning intent', (tester) async {
    await pump(tester, TargetSupportLevel.experimental);
    expect(
      tester.widget<StatusPill>(find.byType(StatusPill)).intent,
      StatusIntent.warning,
    );
    expect(find.text('EXPERIMENTAL'), findsOneWidget);
  });
}

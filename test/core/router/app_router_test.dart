import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/router/app_router.dart';

void main() {
  testWidgets('router renders connect route initially', (tester) async {
    await tester.pumpWidget(
      MaterialApp.router(routerConfig: buildAppRouter()),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect'), findsOneWidget);
  });
}

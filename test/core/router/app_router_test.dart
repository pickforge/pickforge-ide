import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/di/injection.dart';
import 'package:pickforge/core/router/app_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    return getIt.reset();
  });

  testWidgets('router renders connect route initially', (tester) async {
    await configureDependencies();
    await tester.pumpWidget(
      MaterialApp.router(routerConfig: buildAppRouter()),
    );
    await tester.pumpAndSettle();
    expect(find.text('Connect to VM Service'), findsOneWidget);
  });
}

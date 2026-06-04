import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/widget_picker/widgets/no_selection_placeholder.dart';

void main() {
  testWidgets(
      'does not animate placeholder text when reduced motion is enabled',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: NoSelectionPlaceholder(),
        ),
      ),
    );

    expect(
      find.text('Tap a widget in the emulator to pick it'),
      findsOneWidget,
    );
    expect(find.byType(Animate), findsNothing);
  });
}

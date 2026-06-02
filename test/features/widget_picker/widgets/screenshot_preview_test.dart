import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/features/widget_picker/widgets/screenshot_preview.dart';

void main() {
  testWidgets('null path renders nothing', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ScreenshotPreview()),
    );

    expect(find.byType(Image), findsNothing);
  });

  testWidgets('path renders image preview', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ScreenshotPreview(path: '/tmp/screenshot.png')),
    );

    expect(find.byType(Image), findsOneWidget);
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/agent/widget_context_renderer.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  group('WidgetContextRenderer', () {
    const renderer = WidgetContextRenderer();

    test('renders widget name, location, ancestors, and snippet', () {
      const widget = SelectedWidget(
        node: WidgetNode(
          id: 'w-1',
          className: 'MyWidget',
          children: [],
          creationLocation: CreationLocation(
            file: 'lib/main.dart',
            line: 42,
            column: 10,
          ),
        ),
        ancestorClasses: ['MaterialApp', 'Scaffold', 'Center'],
        sourceSnippet: 'MyWidget(\n  key: ValueKey(1),\n)',
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      );

      final result = renderer.render(widget);

      expect(result, contains('# Widget Context'));
      expect(result, contains('**Class:** `MyWidget`'));
      expect(result, contains('**ID:** `w-1`'));
      expect(result, contains('**File:** `lib/main.dart`'));
      expect(result, contains('**Line:** 42'));
      expect(result, contains('**Column:** 10'));
      expect(result, contains('`MaterialApp`'));
      expect(result, contains('`Scaffold`'));
      expect(result, contains('`Center`'));
      expect(result, contains('```dart'));
      expect(result, contains('MyWidget('));
    });

    test('handles missing creation location', () {
      const widget = SelectedWidget(
        node: WidgetNode(
          id: 'w-2',
          className: 'Container',
          children: [],
          creationLocation: null,
        ),
        ancestorClasses: [],
        sourceSnippet: null,
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      );

      final result = renderer.render(widget);

      expect(result, contains('**Class:** `Container`'));
      expect(result, isNot(contains('## Creation Location')));
      expect(result, isNot(contains('## Ancestor Chain')));
      expect(result, isNot(contains('## Source Snippet')));
    });

    test('handles empty ancestor list', () {
      const widget = SelectedWidget(
        node: WidgetNode(
          id: 'w-3',
          className: 'Text',
          children: [],
          creationLocation: null,
        ),
        ancestorClasses: [],
        sourceSnippet: null,
        screenshotPath: null,
        adbScreenshotPath: null,
        propertiesJson: {},
      );

      final result = renderer.render(widget);

      expect(result, isNot(contains('## Ancestor Chain')));
    });
  });
}

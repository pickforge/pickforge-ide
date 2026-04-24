import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';

void main() {
  group('WidgetNode', () {
    test('round-trips through JSON', () {
      const node = WidgetNode(
        id: 'inspector-0',
        className: 'ElevatedButton',
        children: [],
        creationLocation: CreationLocation(
          file: 'lib/foo.dart',
          line: 10,
          column: 3,
        ),
      );
      final json = node.toJson();
      final decoded = WidgetNode.fromJson(json);
      expect(decoded, node);
    });

    test('isUserCode returns false when creationLocation is null', () {
      const node = WidgetNode(
        id: 'x',
        className: 'Padding',
        children: [],
        creationLocation: null,
      );
      expect(node.isUserCode, isFalse);
    });
  });
}

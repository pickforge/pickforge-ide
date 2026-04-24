import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/widget_tree_decoder.dart';

void main() {
  test('decodes a minimal diagnostic node tree', () {
    final raw = {
      'valueId': 'inspector-0',
      'description': 'MyApp',
      'creationLocation': {'file': 'lib/main.dart', 'line': 3, 'column': 1},
      'children': [
        {
          'valueId': 'inspector-1',
          'description': 'Text',
          'creationLocation': {
            'file': 'lib/main.dart',
            'line': 10,
            'column': 5,
          },
          'children': <Map<String, dynamic>>[],
        },
      ],
    };

    final node = WidgetTreeDecoder.decode(raw);

    expect(node.className, 'MyApp');
    expect(node.children, hasLength(1));
    expect(node.children.first.className, 'Text');
    expect(node.creationLocation!.file, 'lib/main.dart');
  });

  test('decodes a node without creationLocation', () {
    final raw = {
      'valueId': 'inspector-7',
      'description': 'Padding',
      'children': <Map<String, dynamic>>[],
    };
    final node = WidgetTreeDecoder.decode(raw);
    expect(node.creationLocation, isNull);
    expect(node.isUserCode, isFalse);
  });
}

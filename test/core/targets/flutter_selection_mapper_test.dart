import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/targets/flutter/flutter_selection_mapper.dart';

SelectedWidget _selection({
  CreationLocation? location =
      const CreationLocation(file: 'lib/main.dart', line: 42, column: 7),
}) {
  return SelectedWidget(
    node: WidgetNode(
      id: 'w-1',
      className: 'EmberButton',
      children: const [
        WidgetNode(
          id: 'w-2',
          className: 'Text',
          children: [],
          creationLocation: null,
        ),
      ],
      creationLocation: location,
    ),
    ancestorClasses: const ['Column', 'Scaffold'],
    sourceSnippet: 'EmberButton(label: ...)',
    screenshotPath: '/ctx/widget.png',
    adbScreenshotPath: '/ctx/device.png',
    propertiesJson: const {
      'label': 'Forge',
      'enabled': true,
      'padding': {'left': 8, 'right': 8},
    },
  );
}

void main() {
  const mapper = FlutterSelectionMapper();

  test('maps every generic field from the selected widget', () {
    final selected = _selection();
    final context = mapper.map(selected);
    final target = context.targetSelection;

    expect(target.id, 'w-1');
    expect(target.label, 'EmberButton');
    expect(target.sourcePath, 'lib/main.dart');
    expect(target.sourceLine, 42);
    expect(target.screenshotPath, '/ctx/widget.png');
    expect(jsonDecode(target.propertiesJson!), selected.propertiesJson);
  });

  test('retains the full flutter selection without precision loss', () {
    final selected = _selection();
    final context = mapper.map(selected);

    expect(context.flutterSelection, same(selected));
    expect(context.toJson()['flutter'], selected.toJson());
  });

  test('toJson exposes the generic projection under targetSelection', () {
    final context = mapper.map(_selection());
    final json = context.toJson()['targetSelection']! as Map<String, Object?>;

    expect(json['id'], 'w-1');
    expect(json['label'], 'EmberButton');
    expect(json['sourcePath'], 'lib/main.dart');
    expect(json['sourceLine'], 42);
    expect(json['screenshotPath'], '/ctx/widget.png');
    expect(
      json['propertiesJson'],
      jsonEncode(const {
        'label': 'Forge',
        'enabled': true,
        'padding': {'left': 8, 'right': 8},
      }),
    );
  });

  test('leaves source fields null when creation location is absent', () {
    final context = mapper.map(_selection(location: null));
    final target = context.targetSelection;

    expect(target.sourcePath, isNull);
    expect(target.sourceLine, isNull);
    expect(target.id, 'w-1');
    expect(target.label, 'EmberButton');
  });
}

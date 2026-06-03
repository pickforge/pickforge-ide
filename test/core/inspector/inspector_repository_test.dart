import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/inspector/inspector_repository.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';
import 'package:pickforge/core/vm_service/inspector_extensions.dart';

class _MockExt extends Mock implements InspectorExtensions {}

class _MockSourceExtractor extends Mock implements SourceSnippetExtractor {}

class _FakeCreationLocation extends Fake implements CreationLocation {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeCreationLocation());
  });

  late _MockExt ext;
  late _MockSourceExtractor src;
  late InspectorRepository repo;

  setUp(() {
    ext = _MockExt();
    src = _MockSourceExtractor();
    repo = InspectorRepository(ext, src);
  });

  test('fetchSelection combines tree + source + extension data', () async {
    when(ext.getSelectedWidget).thenAnswer(
      (_) async => {
        'valueId': 'x',
        'description': 'ElevatedButton',
        'creationLocation': {
          'file': 'lib/foo.dart',
          'line': 10,
          'column': 3,
        },
        'children': <Map<String, dynamic>>[],
      },
    );
    when(ext.getRootWidgetSummaryTree).thenAnswer(
      (_) async => {
        'valueId': 'root',
        'description': 'MyApp',
        'creationLocation': <String, dynamic>{
          'file': 'lib/main.dart',
          'line': 1,
          'column': 1,
        },
        'children': <Map<String, dynamic>>[
          {
            'valueId': 'x',
            'description': 'ElevatedButton',
            'creationLocation': <String, dynamic>{
              'file': 'lib/foo.dart',
              'line': 10,
              'column': 3,
            },
            'children': <Map<String, dynamic>>[],
          },
        ],
      },
    );
    when(() => src.extract(any(), projectRoot: any(named: 'projectRoot')))
        .thenAnswer((_) async => '   10  ElevatedButton(...)');

    final selected = await repo.fetchSelection();

    expect(selected, isNotNull);
    expect(selected!.node.className, 'ElevatedButton');
    expect(selected.sourceSnippet, contains('ElevatedButton'));
    expect(selected.ancestorClasses, contains('MyApp'));
  });

  test('fetchSelection writes inspector screenshot under .pickforge', () async {
    final tmp = await Directory.systemTemp.createTemp('pf_inspector_');
    addTearDown(() => tmp.delete(recursive: true));
    repo = InspectorRepository(ext, src, projectRoot: tmp.path);

    when(ext.getSelectedWidget).thenAnswer(
      (_) async => {
        'valueId': 'x',
        'description': 'ElevatedButton',
        'creationLocation': {
          'file': p.join(tmp.path, 'lib', 'foo.dart'),
          'line': 10,
          'column': 3,
        },
        'children': <Map<String, dynamic>>[],
      },
    );
    when(ext.getRootWidgetSummaryTree).thenAnswer((_) async => null);
    when(() => src.extract(any(), projectRoot: any(named: 'projectRoot')))
        .thenAnswer((_) async => null);
    when(
      () => ext.screenshot(
        id: any(named: 'id'),
        width: any(named: 'width'),
        height: any(named: 'height'),
        margin: any(named: 'margin'),
        maxPixelRatio: any(named: 'maxPixelRatio'),
      ),
    ).thenAnswer((_) async => [1, 2, 3]);

    final selected = await repo.fetchSelection();

    expect(
      selected!.screenshotPath,
      p.join(tmp.path, '.pickforge', 'screenshot.png'),
    );
    expect(File(selected.screenshotPath!).readAsBytesSync(), [1, 2, 3]);
    expect(
      File(p.join(tmp.path, '.pickforge', '.gitignore')).readAsStringSync(),
      '*\n',
    );
    verify(
      () => ext.screenshot(
        id: 'x',
        width: 480,
        height: 480,
        margin: 16,
        maxPixelRatio: 2,
      ),
    ).called(1);
  });
}

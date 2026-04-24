import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
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
    when(() => src.extract(any()))
        .thenAnswer((_) async => '   10  ElevatedButton(...)');

    final selected = await repo.fetchSelection();

    expect(selected, isNotNull);
    expect(selected!.node.className, 'ElevatedButton');
    expect(selected.sourceSnippet, contains('ElevatedButton'));
    expect(selected.ancestorClasses, contains('MyApp'));
  });
}

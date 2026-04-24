import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/inspector/models.dart';
import 'package:pickforge/core/inspector/source_snippet_extractor.dart';

void main() {
  late Directory tmp;
  setUp(() => tmp = Directory.systemTemp.createTempSync('pickforge_src_'));
  tearDown(() => tmp.deleteSync(recursive: true));

  test('extracts ±contextLines around the creation line', () async {
    final file = File('${tmp.path}/foo.dart');
    await file.writeAsString(List.generate(20, (i) => 'line $i').join('\n'));
    const extractor = SourceSnippetExtractor(contextLines: 2);
    final snippet = await extractor.extract(
      CreationLocation(file: file.path, line: 10, column: 1),
    );
    expect(snippet, contains('line 7'));
    expect(snippet, contains('line 9'));
    expect(snippet, contains('line 11'));
    expect(snippet, isNot(contains('line 4')));
  });

  test('returns null when file does not exist', () async {
    const extractor = SourceSnippetExtractor();
    final snippet = await extractor.extract(
      const CreationLocation(file: '/no/such/file.dart', line: 1, column: 1),
    );
    expect(snippet, isNull);
  });
}

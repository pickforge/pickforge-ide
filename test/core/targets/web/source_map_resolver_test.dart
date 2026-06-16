import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/targets/web/source_map_resolver.dart';

// The canonical Source Map v3 example (Mozilla / source-map spec). Decoded
// generated-line-0 segments include known positions used as assertions below.
const _exampleMap = '''
{
  "version": 3,
  "file": "min.js",
  "names": ["bar", "baz", "n"],
  "sources": ["one.js", "two.js"],
  "sourceRoot": "http://example.com/www/js/",
  "mappings": "CAAC,IAAI,IAAM,SAAUA,GAClB,OAAOC,IAAID;CCDF,IAAI,IAAM,SAAUE,GAClB,OAAOA"
}
''';

void main() {
  test('decodes generated positions to original source positions', () {
    final map = SourceMap.parse(_exampleMap)!;

    // Segment "CAAC": generated col 1 -> one.js 0:1, no name.
    final first = map.originalPositionFor(0, 1)!;
    expect(first.source, 'one.js');
    expect(first.line, 0);
    expect(first.column, 1);
    expect(first.name, isNull);

    // Segment "IAAI": generated col 5 -> one.js 0:5.
    final second = map.originalPositionFor(0, 5)!;
    expect(second.line, 0);
    expect(second.column, 5);

    // Segment "SAAUA": generated col 18 -> one.js 0:21, name "bar".
    final named = map.originalPositionFor(0, 18)!;
    expect(named.source, 'one.js');
    expect(named.column, 21);
    expect(named.name, 'bar');

    // Segment "GAClB" carries a multi-digit negative original-column delta
    // (-18): generated col 21 -> one.js original line 1, col 3.
    final negativeDelta = map.originalPositionFor(0, 21)!;
    expect(negativeDelta.source, 'one.js');
    expect(negativeDelta.line, 1);
    expect(negativeDelta.column, 3);
  });

  test('rejects a truncated VLQ (continuation bit on the final digit)', () {
    // "g" = 32 -> continuation bit set, no following digit: a truncated field.
    const truncated = '{"version": 3, "sources": ["a.js"], "mappings": "g"}';
    final map = SourceMap.parse(truncated)!;
    expect(map.originalPositionFor(0, 0), isNull);
  });

  test('snaps a column to the nearest mapped segment at or before it', () {
    final map = SourceMap.parse(_exampleMap)!;
    // Column 6 falls between segments at gen-col 5 and 9 -> snaps to 5.
    final snapped = map.originalPositionFor(0, 6)!;
    expect(snapped.column, 5);
  });

  test('returns null before the first segment and off the end', () {
    final map = SourceMap.parse(_exampleMap)!;
    // First segment starts at generated column 1, so column 0 maps to nothing.
    expect(map.originalPositionFor(0, 0), isNull);
    expect(map.originalPositionFor(999, 0), isNull);
  });

  test('resolveSource joins sourceRoot', () {
    final map = SourceMap.parse(_exampleMap)!;
    expect(map.resolveSource('one.js'), 'http://example.com/www/js/one.js');
  });

  test('tolerates malformed JSON and missing mappings', () {
    expect(SourceMap.parse('not json'), isNull);
    expect(SourceMap.parse('[]'), isNull);

    final empty =
        SourceMap.parse('{"version": 3, "sources": [], "names": []}')!;
    expect(empty.originalPositionFor(0, 0), isNull);
  });
}

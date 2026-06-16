import 'dart:convert';

import 'package:equatable/equatable.dart';

/// An original source position recovered from a generated position.
class SourceMapping extends Equatable {
  const SourceMapping({
    required this.source,
    required this.line,
    required this.column,
    this.name,
  });

  /// The original source file as named in the map's `sources` (not joined with
  /// `sourceRoot`; use [SourceMap.resolveSource] for that).
  final String source;

  /// Zero-based original line and column.
  final int line;
  final int column;

  /// The original identifier name, when the segment carried one.
  final String? name;

  @override
  List<Object?> get props => [source, line, column, name];
}

/// Decodes a Source Map v3 document and answers generated → original position
/// queries. Pure and fixture-testable: it parses the `.map` JSON a live CDP /
/// Metro session would fetch, with no network or browser.
///
/// The `mappings` field is Base64-VLQ; this decoder follows the v3 spec where
/// the generated column resets per generated line and the source/original
/// line/column/name indices accumulate across the whole document.
class SourceMap extends Equatable {
  const SourceMap._({
    required this.sources,
    required this.names,
    required this.sourceRoot,
    required List<List<_Segment>> lines,
  }) : _lines = lines;

  final List<String> sources;
  final List<String> names;
  final String? sourceRoot;
  final List<List<_Segment>> _lines;

  /// Parses [json]; returns `null` on malformed JSON or a non-object payload.
  static SourceMap? parse(String json) {
    final Object? decoded;
    try {
      decoded = jsonDecode(json);
    } on FormatException {
      return null;
    }
    if (decoded is! Map<String, Object?>) return null;

    final sources = _stringList(decoded['sources']);
    final names = _stringList(decoded['names']);
    final mappings = decoded['mappings'];
    final sourceRoot = decoded['sourceRoot'];

    return SourceMap._(
      sources: sources,
      names: names,
      sourceRoot:
          sourceRoot is String && sourceRoot.isNotEmpty ? sourceRoot : null,
      lines: mappings is String ? _decodeMappings(mappings) : const [],
    );
  }

  /// The original position for a zero-based generated [line]/[column], snapping
  /// to the nearest mapped segment at or before [column]. Returns `null` when
  /// the line has no segments, none start at or before [column], or the segment
  /// carries no source. Out-of-range `sourceIndex`/`nameIndex` are dropped.
  SourceMapping? originalPositionFor(int line, int column) {
    if (line < 0 || line >= _lines.length) return null;
    final segments = _lines[line];

    _Segment? best;
    for (final segment in segments) {
      if (segment.generatedColumn > column) break;
      best = segment;
    }
    if (best == null || best.sourceIndex == null) return null;
    if (best.sourceIndex! < 0 || best.sourceIndex! >= sources.length) {
      return null;
    }

    final nameIndex = best.nameIndex;
    final name =
        (nameIndex != null && nameIndex >= 0 && nameIndex < names.length)
            ? names[nameIndex]
            : null;
    return SourceMapping(
      source: sources[best.sourceIndex!],
      line: best.originalLine!,
      column: best.originalColumn!,
      name: name,
    );
  }

  /// [source] joined with `sourceRoot` (slash-separated), or [source] unchanged
  /// when no root is set.
  String resolveSource(String source) {
    final root = sourceRoot;
    if (root == null) return source;
    return root.endsWith('/') ? '$root$source' : '$root/$source';
  }

  static List<String> _stringList(Object? value) => value is List
      ? value.map((e) => e.toString()).toList(growable: false)
      : const [];

  static List<List<_Segment>> _decodeMappings(String mappings) {
    final lines = <List<_Segment>>[];
    var sourceIndex = 0;
    var originalLine = 0;
    var originalColumn = 0;
    var nameIndex = 0;

    for (final lineGroup in mappings.split(';')) {
      final segments = <_Segment>[];
      var generatedColumn = 0;
      for (final raw in lineGroup.split(',')) {
        if (raw.isEmpty) continue;
        final fields = _decodeVlqSegment(raw);
        if (fields == null || fields.isEmpty) continue;
        generatedColumn += fields[0];
        if (fields.length >= 4) {
          sourceIndex += fields[1];
          originalLine += fields[2];
          originalColumn += fields[3];
          int? segmentName;
          if (fields.length >= 5) {
            nameIndex += fields[4];
            segmentName = nameIndex;
          }
          segments.add(
            _Segment(
              generatedColumn: generatedColumn,
              sourceIndex: sourceIndex,
              originalLine: originalLine,
              originalColumn: originalColumn,
              nameIndex: segmentName,
            ),
          );
        } else {
          segments.add(_Segment(generatedColumn: generatedColumn));
        }
      }
      lines.add(segments);
    }
    return lines;
  }

  /// Decodes one comma-segment of VLQ fields; `null` on an invalid Base64 char.
  static List<int>? _decodeVlqSegment(String segment) {
    final values = <int>[];
    var result = 0;
    var shift = 0;
    for (var i = 0; i < segment.length; i++) {
      final digit = _base64Index(segment.codeUnitAt(i));
      if (digit == -1) return null;
      final continuation = (digit & 32) != 0;
      result += (digit & 31) << shift;
      if (continuation) {
        shift += 5;
      } else {
        final negative = (result & 1) == 1;
        final magnitude = result >> 1;
        values.add(negative ? -magnitude : magnitude);
        result = 0;
        shift = 0;
      }
    }
    // A continuation bit set on the final digit is a truncated VLQ.
    if (shift != 0) return null;
    return values;
  }

  /// Base64 alphabet index (A-Z, a-z, 0-9, +, /), or -1 for any other char.
  static int _base64Index(int charCode) {
    if (charCode >= 0x41 && charCode <= 0x5A) return charCode - 0x41;
    if (charCode >= 0x61 && charCode <= 0x7A) return charCode - 0x61 + 26;
    if (charCode >= 0x30 && charCode <= 0x39) return charCode - 0x30 + 52;
    if (charCode == 0x2B) return 62;
    if (charCode == 0x2F) return 63;
    return -1;
  }

  @override
  List<Object?> get props => [sources, names, sourceRoot, _lines];
}

class _Segment extends Equatable {
  const _Segment({
    required this.generatedColumn,
    this.sourceIndex,
    this.originalLine,
    this.originalColumn,
    this.nameIndex,
  });

  final int generatedColumn;
  final int? sourceIndex;
  final int? originalLine;
  final int? originalColumn;
  final int? nameIndex;

  @override
  List<Object?> get props =>
      [generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex];
}

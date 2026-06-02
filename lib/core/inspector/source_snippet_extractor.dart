import 'dart:io';

import 'package:pickforge/core/inspector/creation_location_paths.dart';
import 'package:pickforge/core/inspector/models/creation_location.dart';

class SourceSnippetExtractor {
  const SourceSnippetExtractor({this.contextLines = 20});

  final int contextLines;

  Future<String?> extract(CreationLocation loc) async {
    final path = creationLocationFilePath(loc.file);
    if (path == null) return null;
    final file = File(path);
    if (!file.existsSync()) return null;
    final lines = await file.readAsLines();
    final start = (loc.line - contextLines - 1).clamp(0, lines.length);
    final end = (loc.line + contextLines).clamp(0, lines.length);
    final slice = lines.sublist(start, end);
    final withNumbers = <String>[
      for (var i = 0; i < slice.length; i++)
        '${(start + i + 1).toString().padLeft(4)}  ${slice[i]}',
    ];
    return withNumbers.join('\n');
  }
}

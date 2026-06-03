import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/context_attachment_policy.dart';
import 'package:pickforge/core/agent/context_redactor.dart';

class ContextAttachmentRenderer {
  const ContextAttachmentRenderer({
    this.maxBytesPerFile = 32 * 1024,
    this.redactor = const ContextRedactor(),
    this.policy = const ContextAttachmentPolicy(),
  });

  final int maxBytesPerFile;
  final ContextRedactor redactor;
  final ContextAttachmentPolicy policy;

  Future<String> render({
    required String projectRoot,
    required List<String> paths,
  }) async {
    if (paths.isEmpty) return '';
    final root = p.normalize(p.absolute(projectRoot));
    final buf = StringBuffer()
      ..writeln()
      ..writeln('## Attached Files')
      ..writeln();

    for (final rawPath in paths) {
      final absolute = p.normalize(p.absolute(rawPath));
      if (absolute != root && !p.isWithin(root, absolute)) {
        buf
          ..writeln('### `$rawPath`')
          ..writeln('Skipped: outside the active project.')
          ..writeln();
        continue;
      }
      final entityType = FileSystemEntity.typeSync(
        absolute,
        followLinks: false,
      );
      if (entityType == FileSystemEntityType.link) {
        final relative = p.relative(absolute, from: root).replaceAll(r'\', '/');
        buf
          ..writeln('### `$relative`')
          ..writeln('Skipped: blocked: symbolic links are not attachable.')
          ..writeln();
        continue;
      }
      if (entityType != FileSystemEntityType.file) continue;
      final file = File(absolute);
      if (!file.existsSync()) continue;
      final relative = p.relative(absolute, from: root).replaceAll(r'\', '/');
      final blockedReason = policy.blockedReason(relative);
      if (blockedReason != null) {
        buf
          ..writeln('### `$relative`')
          ..writeln('Skipped: $blockedReason.')
          ..writeln();
        continue;
      }
      final length = await file.length();
      if (length > maxBytesPerFile) {
        buf
          ..writeln('### `$relative`')
          ..writeln('Skipped: file is larger than $maxBytesPerFile bytes.')
          ..writeln();
        continue;
      }
      final content = redactor.redact(
        utf8.decode(await file.readAsBytes(), allowMalformed: true),
      );
      buf
        ..writeln('### `$relative`')
        ..writeln('```')
        ..writeln(content)
        ..writeln('```')
        ..writeln();
    }

    return buf.toString();
  }
}

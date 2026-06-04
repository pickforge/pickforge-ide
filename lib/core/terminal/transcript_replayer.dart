import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/ansi.dart';

class TranscriptReplayer {
  TranscriptReplayer({
    required this.projectRoot,
    required this.chatId,
    this.chunkBytes = 64 * 1024,
  });

  final String projectRoot;
  final String chatId;
  final int chunkBytes;

  Stream<List<int>> replay() async* {
    final f = File(
      p.join(projectRoot, '.pickforge', 'chats', chatId, 'transcript.log'),
    );
    if (!f.existsSync()) return;
    final bytes = await f.readAsBytes();
    final stripped = utf8.encode(
      stripAnsi(utf8.decode(bytes, allowMalformed: true)),
    );
    for (var offset = 0; offset < stripped.length; offset += chunkBytes) {
      final end = offset + chunkBytes;
      yield stripped.sublist(
        offset,
        end > stripped.length ? stripped.length : end,
      );
    }
  }
}

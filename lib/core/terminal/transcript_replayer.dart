import 'dart:io';

import 'package:path/path.dart' as p;

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
    final raf = f.openSync();
    try {
      while (true) {
        final chunk = raf.readSync(chunkBytes);
        if (chunk.isEmpty) break;
        yield chunk;
      }
    } finally {
      raf.closeSync();
    }
  }
}

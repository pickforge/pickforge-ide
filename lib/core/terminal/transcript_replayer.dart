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
    final bytes = await f.readAsBytes();
    for (var offset = 0; offset < bytes.length; offset += chunkBytes) {
      final end = offset + chunkBytes;
      yield bytes.sublist(
        offset,
        end > bytes.length ? bytes.length : end,
      );
    }
  }
}

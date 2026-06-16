import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_service.dart';

class TranscriptReplayer {
  TranscriptReplayer({
    required this.projectRoot,
    required this.chatId,
    ContextStorageService? storage,
    this.chunkBytes = 64 * 1024,
  }) : _storage = storage ?? ContextStorageService();

  final String projectRoot;
  final String chatId;
  final ContextStorageService _storage;
  final int chunkBytes;

  Stream<List<int>> replay() async* {
    final resolved = await _storage.resolve(projectRoot);
    final f = File(
      p.join(resolved.chatsDir, chatId, 'transcript.log'),
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

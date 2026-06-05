import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/transcript_replayer.dart';

void main() {
  late Directory tmp;
  setUp(() async => tmp = await Directory.systemTemp.createTemp('pf_replay'));
  tearDown(() async => tmp.delete(recursive: true));

  test('replay yields chunks of recorded text', () async {
    final dir = Directory(p.join(tmp.path, '.pickforge', 'chats', 'c1'))
      ..createSync(recursive: true);
    File(p.join(dir.path, 'transcript.log')).writeAsStringSync('hello world');
    final r = TranscriptReplayer(
      projectRoot: tmp.path,
      chatId: 'c1',
      chunkBytes: 4,
    );
    final chunks = <String>[];
    await for (final ch in r.replay()) {
      chunks.add(String.fromCharCodes(ch));
    }
    expect(chunks.join(), 'hello world');
    expect(chunks.length, greaterThan(1));
  });

  test('replay returns empty stream for missing transcript', () async {
    final r = TranscriptReplayer(projectRoot: tmp.path, chatId: 'missing');
    expect(await r.replay().toList(), isEmpty);
  });

  test('replay preserves recorded terminal control sequences', () async {
    final dir = Directory(p.join(tmp.path, '.pickforge', 'chats', 'stale'))
      ..createSync(recursive: true);
    const raw = '\x1B[38;2;215;119;87morange\x1B[0m';
    File(p.join(dir.path, 'transcript.log')).writeAsStringSync(
      raw,
    );

    final r = TranscriptReplayer(projectRoot: tmp.path, chatId: 'stale');
    final chunks = <String>[];
    await for (final ch in r.replay()) {
      chunks.add(String.fromCharCodes(ch));
    }

    expect(chunks.join(), raw);
  });

  test('replay handles large transcripts in bounded chunks', () async {
    final dir = Directory(p.join(tmp.path, '.pickforge', 'chats', 'large'))
      ..createSync(recursive: true);
    const size = 2 * 1024 * 1024 + 123;
    const chunkBytes = 8192;
    final bytes = List<int>.filled(size, 'a'.codeUnitAt(0));
    File(p.join(dir.path, 'transcript.log')).writeAsBytesSync(bytes);

    final r = TranscriptReplayer(
      projectRoot: tmp.path,
      chatId: 'large',
      chunkBytes: chunkBytes,
    );
    final stopwatch = Stopwatch()..start();
    var totalBytes = 0;
    var maxChunkBytes = 0;
    var chunkCount = 0;
    var checksum = 0;

    await for (final chunk in r.replay()) {
      chunkCount++;
      totalBytes += chunk.length;
      if (chunk.length > maxChunkBytes) maxChunkBytes = chunk.length;
      for (final byte in chunk) {
        checksum = (checksum + byte) & 0x7fffffff;
      }
    }
    stopwatch.stop();

    final expectedChecksum = bytes.fold<int>(
      0,
      (sum, byte) => (sum + byte) & 0x7fffffff,
    );
    expect(totalBytes, size);
    expect(maxChunkBytes, lessThanOrEqualTo(chunkBytes));
    expect(chunkCount, (size / chunkBytes).ceil());
    expect(checksum, expectedChecksum);
    expect(stopwatch.elapsedMilliseconds, lessThan(2000));
  });
}

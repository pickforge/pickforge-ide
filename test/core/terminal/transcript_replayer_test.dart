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
}

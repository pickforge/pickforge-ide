import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/transcript_recorder.dart';

void main() {
  late Directory tmp;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_recorder');
  });

  tearDown(() async => tmp.delete(recursive: true));

  test('writes stripped text and meta', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c1',
      maxBytes: 1024 * 1024,
    );
    await rec.open();
    rec.append('\x1B[31mred\x1B[0m plain'.codeUnits);
    await rec.close();

    final log =
        File(p.join(tmp.path, '.pickforge', 'chats', 'c1', 'transcript.log'));
    final meta =
        File(p.join(tmp.path, '.pickforge', 'chats', 'c1', 'meta.json'));
    expect(log.existsSync(), isTrue);
    expect(log.readAsStringSync(), 'red plain');
    expect(meta.existsSync(), isTrue);
    expect(
      File(p.join(tmp.path, '.pickforge', '.gitignore')).readAsStringSync(),
      '*\n',
    );
  });

  test('writes binary varint-framed spans sidecar', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c_bin',
      maxBytes: 1024 * 1024,
    );
    await rec.open();
    rec.append('\x1B[31mred\x1B[0m');
    await rec.close();

    final spans = File(
      p.join(tmp.path, '.pickforge', 'chats', 'c_bin', 'transcript.spans.bin'),
    );
    expect(spans.existsSync(), isTrue);
    expect(spans.lengthSync(), greaterThan(0));
  });

  test('head-truncates when over cap', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c2',
      maxBytes: 16,
      truncateAt: 24,
    );
    await rec.open();
    rec.append(List.filled(30, 'a').join());
    await rec.flush();
    final log =
        File(p.join(tmp.path, '.pickforge', 'chats', 'c2', 'transcript.log'));
    expect(log.lengthSync(), lessThanOrEqualTo(16));
    await rec.close();
  });
}

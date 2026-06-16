import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/transcript_recorder.dart';

void main() {
  late Directory tmp;
  late Directory home;
  late ContextStorageService storage;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_recorder');
    home = await Directory.systemTemp.createTemp('pf_recorder_home');
    storage = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': home.path},
    );
    // Mark project-local so paths stay byte-identical to the legacy layout.
    Directory(p.join(tmp.path, '.pickforge')).createSync(recursive: true);
    File(p.join(tmp.path, '.pickforge', '.gitignore')).writeAsStringSync('*\n');
  });

  tearDown(() async {
    await tmp.delete(recursive: true);
    await home.delete(recursive: true);
  });

  test('writes raw terminal output and meta', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c1',
      storage: storage,
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
    expect(log.readAsStringSync(), '\x1B[31mred\x1B[0m plain');
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
      storage: storage,
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
      storage: storage,
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

  test('close writes meta even when chat directory is missing', () async {
    final rec = TranscriptRecorder(
      projectRoot: tmp.path,
      chatId: 'c_missing_dir',
      storage: storage,
      maxBytes: 1024 * 1024,
    );

    await rec.close();

    final meta = File(
      p.join(tmp.path, '.pickforge', 'chats', 'c_missing_dir', 'meta.json'),
    );
    expect(meta.existsSync(), isTrue);
  });

  test('home mode: clean project records under <home>/projects/<id>/chats',
      () async {
    final clean = await Directory.systemTemp.createTemp('pf_recorder_clean');
    addTearDown(() => clean.delete(recursive: true));

    final rec = TranscriptRecorder(
      projectRoot: clean.path,
      chatId: 'c_home',
      storage: storage,
      maxBytes: 1024 * 1024,
    );
    await rec.open();
    rec.append('hello'.codeUnits);
    await rec.close();

    expect(Directory(p.join(clean.path, '.pickforge')).existsSync(), isFalse);
    final projects = Directory(p.join(home.path, 'projects'));
    final projectDir = projects.listSync().whereType<Directory>().single;
    final log = File(
      p.join(projectDir.path, 'chats', 'c_home', 'transcript.log'),
    );
    expect(log.existsSync(), isTrue);
    expect(log.readAsStringSync(), 'hello');
  });
}

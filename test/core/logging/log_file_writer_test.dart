import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/logging/log_file_writer.dart';

void main() {
  late Directory tmp;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_logs');
  });

  tearDown(() async {
    await tmp.delete(recursive: true);
  });

  LogFileWriter writer({
    int maxRunBytes = 5 * 1024 * 1024,
    int maxTotalBytes = 20 * 1024 * 1024,
    int maxRunFiles = 10,
    DateTime Function()? now,
  }) {
    return LogFileWriter(
      directory: tmp,
      maxRunBytes: maxRunBytes,
      maxTotalBytes: maxTotalBytes,
      maxRunFiles: maxRunFiles,
      now: now ?? () => DateTime(2026, 6, 11, 12),
    );
  }

  test('open creates a timestamped run file and latest.log link', () async {
    final w = writer();
    await w.open();
    addTearDown(w.close);

    expect(
      p.basename(w.currentFile!.path),
      'pickforge_2026-06-11_12-00-00.log',
    );
    final latest = Link(p.join(tmp.path, 'latest.log'));
    // Symlink support depends on the platform; when present it must point
    // at the run file.
    if (latest.existsSync()) {
      expect(latest.targetSync(), p.basename(w.currentFile!.path));
    }
  });

  test('buffered lines reach the file on flush', () async {
    final w = writer();
    await w.open();
    addTearDown(w.close);

    w
      ..writeLine('first line')
      ..writeLine('second line');
    await w.flush();

    final content = await w.currentFile!.readAsString();
    expect(content, 'first line\nsecond line\n');
  });

  test('urgent lines flush without waiting for the timer', () async {
    final w = writer();
    await w.open();
    addTearDown(w.close);

    w.writeLine('boom', urgent: true);
    // No explicit flush: urgent must have done it (allow the microtask).
    await Future<void>.delayed(Duration.zero);
    expect(await w.currentFile!.readAsString(), contains('boom'));
  });

  test('a run is capped and records the truncation', () async {
    final w = writer(maxRunBytes: 64);
    await w.open();
    addTearDown(w.close);

    w
      ..writeLine('x' * 100)
      ..writeLine('this line must be dropped');
    await w.flush();

    final content = await w.currentFile!.readAsString();
    expect(content, contains('log truncated'));
    expect(content, isNot(contains('must be dropped')));
  });

  test('open prunes old runs beyond the file-count budget', () async {
    for (var i = 0; i < 12; i++) {
      File(p.join(tmp.path, 'pickforge_2026-06-01_00-00-${i + 10}.log'))
          .writeAsStringSync('old\n');
    }
    final w = writer(maxRunFiles: 3);
    await w.open();
    addTearDown(w.close);

    final runs = tmp
        .listSync()
        .whereType<File>()
        .where((f) => p.basename(f.path).startsWith('pickforge_'))
        .map((f) => p.basename(f.path))
        .toList()
      ..sort();
    // 2 newest old runs kept + the new run file.
    expect(runs, hasLength(3));
    expect(runs.last, 'pickforge_2026-06-11_12-00-00.log');
  });

  test('open prunes old runs beyond the byte budget', () async {
    for (var i = 0; i < 5; i++) {
      File(p.join(tmp.path, 'pickforge_2026-06-01_00-00-${i + 10}.log'))
          .writeAsStringSync('x' * 100);
    }
    final w = writer(maxTotalBytes: 250);
    await w.open();
    addTearDown(w.close);

    final runs = tmp
        .listSync()
        .whereType<File>()
        .where((f) => p.basename(f.path).startsWith('pickforge_2026-06-01'))
        .toList();
    expect(runs, hasLength(2));
  });

  test('tail returns only the last lines', () async {
    final w = writer();
    await w.open();
    addTearDown(w.close);

    for (var i = 1; i <= 10; i++) {
      w.writeLine('line $i');
    }
    final tail = await w.tail(maxLines: 3);
    expect(tail, 'line 8\nline 9\nline 10');
  });

  test('writes after close are ignored, not crashes', () async {
    final w = writer();
    await w.open();
    await w.close();
    w.writeLine('after close');
    await w.flush();
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/features/forge/cubit/context_attachments_cubit.dart';

void main() {
  late Directory tmp;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('pickforge_context_');
  });

  tearDown(() {
    tmp.deleteSync(recursive: true);
  });

  test('attaches project-local files once', () {
    final file = File(p.join(tmp.path, 'lib', 'main.dart'));
    file.parent.createSync(recursive: true);
    file.writeAsStringSync('void main() {}');
    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..attach(file.path)
      ..attach(file.path);

    expect(cubit.state.attachments, hasLength(1));
    expect(cubit.state.attachments.single.relativePath, 'lib/main.dart');
    expect(cubit.state.attachments.single.byteLength, greaterThan(0));
  });

  test('ignores files outside the project root', () {
    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..attach('/outside.dart');

    expect(cubit.state.attachments, isEmpty);
  });

  test('blocks likely secret attachments', () {
    final file = File(p.join(tmp.path, '.env'))
      ..writeAsStringSync('TOKEN=secret');
    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..attach(file.path);

    expect(cubit.state.attachments, isEmpty);
    expect(cubit.state.lastBlockedPath, '.env');
    expect(cubit.state.lastBlockedReason, contains('secret'));
  });

  test('blocks symlink attachments', () {
    final outside = File(p.join(tmp.parent.path, 'outside.dart'))
      ..writeAsStringSync('secret');
    final link = Link(p.join(tmp.path, 'linked.dart'));
    addTearDown(() {
      if (outside.existsSync()) outside.deleteSync();
    });
    try {
      link.createSync(outside.path);
    } on FileSystemException {
      return;
    }

    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..attach(link.path);

    expect(cubit.state.attachments, isEmpty);
    expect(cubit.state.lastBlockedReason, contains('symbolic links'));
  });

  test('reorders attachments intentionally', () {
    final first = File(p.join(tmp.path, 'a.dart'))..writeAsStringSync('a');
    final second = File(p.join(tmp.path, 'b.dart'))..writeAsStringSync('b');
    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..attach(first.path)
      ..attach(second.path)
      ..moveUp(second.path);

    expect(
      cubit.state.attachments.map((attachment) => attachment.relativePath),
      ['b.dart', 'a.dart'],
    );

    cubit.moveDown(second.path);

    expect(
      cubit.state.attachments.map((attachment) => attachment.relativePath),
      ['a.dart', 'b.dart'],
    );
  });

  test('stores trimmed custom note for intentional context', () {
    final cubit = ContextAttachmentsCubit(projectRoot: tmp.path)
      ..setCustomNote('  change the button color  ');

    expect(cubit.state.customNote, 'change the button color');
    expect(cubit.state.totalBytes, greaterThan(0));
  });
}

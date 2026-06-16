import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/terminal/terminal_paste_controller.dart';

void main() {
  late Directory projectRoot;
  late ContextStorageService storage;
  final typed = <String>[];
  final pasted = <String>[];

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-paste-');
    storage = ContextStorageService.forTesting();
    typed.clear();
    pasted.clear();
  });

  tearDown(() => projectRoot.delete(recursive: true));

  void markProjectLocal() {
    File(p.join(projectRoot.path, '.pickforge', '.gitignore'))
      ..parent.createSync(recursive: true)
      ..writeAsStringSync('*\n');
  }

  Future<void> paste(TerminalPasteController controller) => controller.paste(
        projectRoot: projectRoot.path,
        typeText: typed.add,
        pasteText: pasted.add,
      );

  test('clipboard image is saved and its path typed with a trailing space',
      () async {
    markProjectLocal();
    final controller = TerminalPasteController(
      storage: storage,
      readClipboardImage: () async => Uint8List.fromList([1, 2, 3]),
      readClipboardText: () async => fail('image must win over text'),
    );

    await paste(controller);

    expect(typed, hasLength(1));
    expect(typed.single, startsWith('.pickforge/pastes/paste-'));
    expect(typed.single, endsWith('.png '));
    expect(pasted, isEmpty);
  });

  test('clipboard text is pasted, not typed', () async {
    final controller = TerminalPasteController(
      storage: storage,
      readClipboardImage: () async => null,
      readClipboardText: () async => 'hello\nworld',
    );

    await paste(controller);

    expect(pasted, ['hello\nworld']);
    expect(typed, isEmpty);
  });

  test('an empty clipboard is a no-op', () async {
    final controller = TerminalPasteController(
      storage: storage,
      readClipboardImage: () async => null,
      readClipboardText: () async => null,
    );

    await paste(controller);

    expect(typed, isEmpty);
    expect(pasted, isEmpty);
  });

  test('a failing image reader falls back to text', () async {
    final controller = TerminalPasteController(
      storage: storage,
      readClipboardImage: () async => throw StateError('no clipboard'),
      readClipboardText: () async => 'fallback',
    );

    await paste(controller);

    expect(pasted, ['fallback']);
  });
}

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/terminal/terminal_paste_controller.dart';

void main() {
  late Directory projectRoot;
  final typed = <String>[];
  final pasted = <String>[];

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-paste-');
    typed.clear();
    pasted.clear();
  });

  tearDown(() => projectRoot.delete(recursive: true));

  Future<void> paste(TerminalPasteController controller) => controller.paste(
        projectRoot: projectRoot.path,
        typeText: typed.add,
        pasteText: pasted.add,
      );

  test('clipboard image is saved and its path typed with a trailing space',
      () async {
    final controller = TerminalPasteController(
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
      readClipboardImage: () async => null,
      readClipboardText: () async => 'hello\nworld',
    );

    await paste(controller);

    expect(pasted, ['hello\nworld']);
    expect(typed, isEmpty);
  });

  test('an empty clipboard is a no-op', () async {
    final controller = TerminalPasteController(
      readClipboardImage: () async => null,
      readClipboardText: () async => null,
    );

    await paste(controller);

    expect(typed, isEmpty);
    expect(pasted, isEmpty);
  });

  test('a failing image reader falls back to text', () async {
    final controller = TerminalPasteController(
      readClipboardImage: () async => throw StateError('no clipboard'),
      readClipboardText: () async => 'fallback',
    );

    await paste(controller);

    expect(pasted, ['fallback']);
  });
}

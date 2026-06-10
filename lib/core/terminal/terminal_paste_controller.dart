import 'package:flutter/services.dart';
import 'package:pasteboard/pasteboard.dart';
import 'package:pickforge/core/terminal/pasted_image_store.dart';

typedef ClipboardImageReader = Future<Uint8List?> Function();
typedef ClipboardTextReader = Future<String?> Function();

/// Smart paste for the embedded terminal: a clipboard image is saved to the
/// project and its relative path typed; text goes through the terminal's
/// mode-aware paste.
class TerminalPasteController {
  TerminalPasteController({
    ClipboardImageReader? readClipboardImage,
    ClipboardTextReader? readClipboardText,
    PastedImageStore store = const PastedImageStore(),
  })  : _readImage = readClipboardImage ?? _systemClipboardImage,
        _readText = readClipboardText ?? _systemClipboardText,
        _store = store;

  final ClipboardImageReader _readImage;
  final ClipboardTextReader _readText;
  final PastedImageStore _store;

  Future<void> paste({
    required String projectRoot,
    required void Function(String) typeText,
    required void Function(String) pasteText,
  }) async {
    Uint8List? image;
    try {
      image = await _readImage();
    } on Object {
      image = null;
    }
    if (image != null && image.isNotEmpty) {
      final relPath = await _store.save(image, projectRoot: projectRoot);
      // Trailing space so the user can keep typing after the path.
      typeText('$relPath ');
      return;
    }
    final text = await _readText();
    if (text == null || text.isEmpty) return;
    pasteText(text);
  }

  static Future<Uint8List?> _systemClipboardImage() => Pasteboard.image;

  static Future<String?> _systemClipboardText() async =>
      (await Clipboard.getData(Clipboard.kTextPlain))?.text;
}

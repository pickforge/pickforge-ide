import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/terminal/pasted_image_store.dart';

void main() {
  late Directory projectRoot;

  setUp(() async {
    projectRoot = await Directory.systemTemp.createTemp('pickforge-paste-');
  });

  tearDown(() => projectRoot.delete(recursive: true));

  test('saves the image under .pickforge/pastes and returns a relative path',
      () async {
    const store = PastedImageStore();
    final bytes = Uint8List.fromList([1, 2, 3, 4]);

    final relPath = await store.save(bytes, projectRoot: projectRoot.path);

    expect(relPath, startsWith('.pickforge/pastes/paste-'));
    expect(relPath, endsWith('.png'));
    final file = File(p.join(projectRoot.path, relPath));
    expect(file.existsSync(), isTrue);
    expect(file.readAsBytesSync(), bytes);
  });

  test('consecutive saves do not collide', () async {
    const store = PastedImageStore();
    final a = await store.save(
      Uint8List.fromList([1]),
      projectRoot: projectRoot.path,
    );
    final b = await store.save(
      Uint8List.fromList([2]),
      projectRoot: projectRoot.path,
    );

    expect(a, isNot(b));
    expect(File(p.join(projectRoot.path, a)).existsSync(), isTrue);
    expect(File(p.join(projectRoot.path, b)).existsSync(), isTrue);
  });

  test('prunes pastes older than seven days on save', () async {
    const store = PastedImageStore();
    final dir = Directory(p.join(projectRoot.path, '.pickforge', 'pastes'))
      ..createSync(recursive: true);
    final stale = File(p.join(dir.path, 'paste-old.png'))
      ..writeAsBytesSync([0])
      ..setLastModifiedSync(
        DateTime.now().subtract(const Duration(days: 8)),
      );

    await store.save(Uint8List.fromList([1]), projectRoot: projectRoot.path);

    expect(stale.existsSync(), isFalse);
  });
}

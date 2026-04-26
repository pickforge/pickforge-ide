import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/pickforge_context_writer.dart';

void main() {
  late Directory tmp;
  late PickforgeContextWriter writer;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_writer');
    writer = PickforgeContextWriter();
  });

  tearDown(() async => tmp.delete(recursive: true));

  test('writes skill, widget, prompt and creates .pickforge/ + .gitignore',
      () async {
    final ctx = await writer.write(
      projectRoot: tmp.path,
      skillMarkdown: '# skill',
      widgetContextMarkdown: '# widget',
      initialPrompt: '# prompt',
    );

    final dir = Directory(p.join(tmp.path, '.pickforge'));
    expect(dir.existsSync(), isTrue);
    expect(
      File(p.join(dir.path, '.gitignore')).readAsStringSync(),
      '*\n',
    );
    expect(File(ctx.skillPath).readAsStringSync(), '# skill');
    expect(File(ctx.widgetContextPath).readAsStringSync(), '# widget');
    expect(File(ctx.initialPromptPath).readAsStringSync(), '# prompt');
    expect(ctx.widgetScreenshotPath, isNull);
    expect(ctx.deviceScreenPath, isNull);
  });

  test('writes screenshot bytes when provided', () async {
    final ctx = await writer.write(
      projectRoot: tmp.path,
      skillMarkdown: 's',
      widgetContextMarkdown: 'w',
      initialPrompt: 'p',
      widgetScreenshotPng: [1, 2, 3],
      deviceScreenPng: [4, 5, 6],
    );

    expect(File(ctx.widgetScreenshotPath!).readAsBytesSync(), [1, 2, 3]);
    expect(File(ctx.deviceScreenPath!).readAsBytesSync(), [4, 5, 6]);
  });

  test('throws if .pickforge/ exists without our marker', () async {
    final dir = Directory(p.join(tmp.path, '.pickforge'))
      ..createSync(recursive: true);
    File(p.join(dir.path, 'random.txt')).writeAsStringSync('hi');

    await expectLater(
      writer.write(
        projectRoot: tmp.path,
        skillMarkdown: 's',
        widgetContextMarkdown: 'w',
        initialPrompt: 'p',
      ),
      throwsA(isA<PickforgeDirConflictException>()),
    );
  });
}

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/pickforge_context_writer.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';

void main() {
  late Directory tmp;
  late Directory home;
  late PickforgeContextWriter writer;

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_writer');
    home = await Directory.systemTemp.createTemp('pf_writer_home');
    writer = PickforgeContextWriter(
      ContextStorageService.forTesting(
        environment: {'PICKFORGE_HOME': home.path},
      ),
    );
  });

  tearDown(() async {
    await tmp.delete(recursive: true);
    await home.delete(recursive: true);
  });

  void markProjectLocal(Directory project) {
    final dir = Directory(p.join(project.path, '.pickforge'))
      ..createSync(recursive: true);
    File(p.join(dir.path, '.gitignore')).writeAsStringSync('*\n');
  }

  test('writes skill, widget, prompt and creates .pickforge/ + .gitignore',
      () async {
    markProjectLocal(tmp);

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
    markProjectLocal(tmp);

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

  test('an unmarked .pickforge/ falls back to home storage (no conflict)',
      () async {
    // Auto-detection only treats a project as project-local when the
    // `.pickforge/.gitignore` marker is exactly `*\n`. A stray `.pickforge/`
    // without that marker is left untouched and storage falls back to home.
    final dir = Directory(p.join(tmp.path, '.pickforge'))
      ..createSync(recursive: true);
    File(p.join(dir.path, 'random.txt')).writeAsStringSync('hi');

    final ctx = await writer.write(
      projectRoot: tmp.path,
      skillMarkdown: 's',
      widgetContextMarkdown: 'w',
      initialPrompt: 'p',
    );

    expect(File(p.join(dir.path, 'random.txt')).existsSync(), isTrue);
    expect(File(p.join(dir.path, 'skill-active.md')).existsSync(), isFalse);
    expect(ctx.skillPath, startsWith(home.path));
    expect(File(ctx.skillPath).readAsStringSync(), 's');
  });

  test('parity: project-local marker pins legacy <root>/.pickforge paths',
      () async {
    markProjectLocal(tmp);

    final ctx = await writer.write(
      projectRoot: tmp.path,
      skillMarkdown: 's',
      widgetContextMarkdown: 'w',
      initialPrompt: 'p',
      widgetScreenshotPng: [1],
      deviceScreenPng: [2],
    );

    final base = p.join(tmp.path, '.pickforge');
    expect(ctx.skillPath, p.join(base, 'skill-active.md'));
    expect(ctx.widgetContextPath, p.join(base, 'widget-context.md'));
    expect(ctx.initialPromptPath, p.join(base, 'initial-prompt.md'));
    expect(ctx.widgetScreenshotPath, p.join(base, 'screenshot.png'));
    expect(ctx.deviceScreenPath, p.join(base, 'device-screen.png'));
  });

  test('home mode: clean project writes under <home>/projects/<id>/context',
      () async {
    final ctx = await writer.write(
      projectRoot: tmp.path,
      skillMarkdown: 's',
      widgetContextMarkdown: 'w',
      initialPrompt: 'p',
      widgetScreenshotPng: [1],
    );

    expect(Directory(p.join(tmp.path, '.pickforge')).existsSync(), isFalse);
    final projects = Directory(p.join(home.path, 'projects'));
    expect(projects.existsSync(), isTrue);
    final projectDir = projects.listSync().whereType<Directory>().single;
    final contextDir = p.join(projectDir.path, 'context');
    expect(ctx.skillPath, p.join(contextDir, 'skill-active.md'));
    expect(ctx.widgetContextPath, p.join(contextDir, 'widget-context.md'));
    expect(ctx.initialPromptPath, p.join(contextDir, 'initial-prompt.md'));
    expect(ctx.widgetScreenshotPath, p.join(contextDir, 'screenshot.png'));
    expect(File(ctx.skillPath).readAsStringSync(), 's');
  });
}

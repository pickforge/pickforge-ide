import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/agent/context_attachment_renderer.dart';

void main() {
  late Directory tmp;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('pickforge_attach_');
  });

  tearDown(() {
    tmp.deleteSync(recursive: true);
  });

  test('renders project-local attachments and redacts secrets', () async {
    final file = File(p.join(tmp.path, 'lib', 'main.dart'));
    file.parent.createSync(recursive: true);
    file.writeAsStringSync(
      'const apiKey = "super-secret";\n'
      'OPENAI_API_KEY=abc123\n'
      'GITHUB_TOKEN=ghp_secret\n'
      '{"AWS_SECRET_ACCESS_KEY":"aws-secret"}\n',
    );

    final rendered = await const ContextAttachmentRenderer().render(
      projectRoot: tmp.path,
      paths: [file.path],
    );

    expect(rendered, contains('### `lib/main.dart`'));
    expect(rendered, contains('apiKey=[REDACTED]'));
    expect(rendered, contains('OPENAI_API_KEY=[REDACTED]'));
    expect(rendered, contains('GITHUB_TOKEN=[REDACTED]'));
    expect(rendered, contains('AWS_SECRET_ACCESS_KEY=[REDACTED]'));
    expect(rendered, isNot(contains('super-secret')));
    expect(rendered, isNot(contains('abc123')));
    expect(rendered, isNot(contains('ghp_secret')));
    expect(rendered, isNot(contains('aws-secret')));
  });

  test('skips attachments outside the active project', () async {
    final outside = File(p.join(tmp.parent.path, 'outside.txt'))
      ..writeAsStringSync('outside');
    addTearDown(() {
      if (outside.existsSync()) outside.deleteSync();
    });

    final rendered = await const ContextAttachmentRenderer().render(
      projectRoot: tmp.path,
      paths: [outside.path],
    );

    expect(rendered, contains('Skipped: outside the active project.'));
  });

  test('skips suspicious attachment classes', () async {
    final env = File(p.join(tmp.path, '.env'))..writeAsStringSync('TOKEN=abc');

    final rendered = await const ContextAttachmentRenderer().render(
      projectRoot: tmp.path,
      paths: [env.path],
    );

    expect(rendered, contains('Skipped: blocked: likely secret file.'));
    expect(rendered, isNot(contains('TOKEN=abc')));
  });

  test('skips symbolic links to avoid reading outside project files', () async {
    final outside = File(p.join(tmp.parent.path, 'outside_secret.txt'))
      ..writeAsStringSync('OPENAI_API_KEY=outside');
    final link = Link(p.join(tmp.path, 'linked.txt'));
    addTearDown(() {
      if (outside.existsSync()) outside.deleteSync();
    });
    try {
      link.createSync(outside.path);
    } on FileSystemException {
      return;
    }

    final rendered = await const ContextAttachmentRenderer().render(
      projectRoot: tmp.path,
      paths: [link.path],
    );

    expect(rendered, contains('symbolic links are not attachable'));
    expect(rendered, isNot(contains('outside')));
  });
}

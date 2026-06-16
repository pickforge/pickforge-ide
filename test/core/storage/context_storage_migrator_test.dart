import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:pickforge/core/storage/context_storage_location.dart';
import 'package:pickforge/core/storage/context_storage_migrator.dart';
import 'package:pickforge/core/storage/context_storage_service.dart';
import 'package:pickforge/core/storage/resolved_context_directory.dart';

void main() {
  late Directory tmp;
  late Directory tmpHome;
  late ContextStorageService service;
  const migrator = ContextStorageMigrator();

  setUp(() async {
    tmp = await Directory.systemTemp.createTemp('pf_mig');
    tmpHome = await Directory.systemTemp.createTemp('pf_mig_home');
    service = ContextStorageService.forTesting(
      environment: {'PICKFORGE_HOME': tmpHome.path},
      isWindows: false,
    );
  });

  tearDown(() async {
    await tmp.delete(recursive: true);
    await tmpHome.delete(recursive: true);
  });

  Future<void> writeFile(String path, String content) async {
    final f = File(path);
    await f.parent.create(recursive: true);
    await f.writeAsString(content);
  }

  Future<ResolvedContextDirectory> resolveLocal() => service.resolve(
        tmp.path,
        location: const ContextStorageLocation.projectLocal(),
      );

  Future<ResolvedContextDirectory> resolveHome() => service.resolve(
        tmp.path,
        location: const ContextStorageLocation.pickforgeHome(),
      );

  test('plan counts chats, runs and context files (not the marker)', () async {
    final from = await resolveLocal();
    await writeFile(p.join(from.contextDir, '.gitignore'), '*\n');
    await writeFile(p.join(from.contextDir, 'skill-active.md'), '# skill');
    await writeFile(p.join(from.chatsDir, 'c1', 'transcript.log'), 'a');
    await writeFile(p.join(from.chatsDir, 'c2', 'transcript.log'), 'b');
    await writeFile(p.join(from.runsDir, 'r1', 'log.jsonl'), '{}');

    final plan = migrator.plan(from);
    expect(plan.chatCount, 2);
    expect(plan.runCount, 1);
    expect(plan.hasContextFiles, isTrue);
    expect(plan.isEmpty, isFalse);
  });

  test('plan is empty when only the marker exists', () async {
    final from = await resolveLocal();
    await writeFile(p.join(from.contextDir, '.gitignore'), '*\n');

    expect(migrator.plan(from).isEmpty, isTrue);
  });

  test('plan counts pastes, skills and prompt-templates', () async {
    final from = await resolveLocal();
    await writeFile(p.join(from.pastesDir, 'p1.png'), 'a');
    await writeFile(p.join(from.pastesDir, 'p2.png'), 'b');
    await writeFile(p.join(from.skillsDir, 'skill-a', 'SKILL.md'), '# a');
    await writeFile(p.join(from.promptTemplatesDir, 't1.md'), 'x');

    final plan = migrator.plan(from);
    expect(plan.pasteCount, 2);
    expect(plan.skillCount, 1);
    expect(plan.promptTemplateCount, 1);
    expect(plan.chatCount, 0);
    expect(plan.runCount, 0);
    expect(plan.hasContextFiles, isFalse);
    expect(plan.isEmpty, isFalse);
  });

  test('plan is non-empty when data lives only in a subtree', () async {
    final from = await resolveLocal();
    await writeFile(p.join(from.skillsDir, 'skill-a', 'SKILL.md'), '# a');

    expect(migrator.plan(from).isEmpty, isFalse);
  });

  test('copy local -> home copies trees, skips marker, keeps originals',
      () async {
    final from = await resolveLocal();
    final to = await resolveHome();
    await writeFile(p.join(from.contextDir, '.gitignore'), '*\n');
    await writeFile(p.join(from.contextDir, 'skill-active.md'), '# skill');
    await writeFile(p.join(from.chatsDir, 'c1', 'transcript.log'), 'hello');
    await writeFile(p.join(from.runsDir, 'r1', 'log.jsonl'), '{}');

    await migrator.copy(from, to);

    expect(
      File(p.join(to.contextDir, 'skill-active.md')).readAsStringSync(),
      '# skill',
    );
    expect(File(p.join(to.contextDir, '.gitignore')).existsSync(), isFalse);
    expect(
      File(p.join(to.chatsDir, 'c1', 'transcript.log')).readAsStringSync(),
      'hello',
    );
    expect(File(p.join(to.runsDir, 'r1', 'log.jsonl')).existsSync(), isTrue);
    // Originals retained.
    expect(
      File(p.join(from.contextDir, 'skill-active.md')).existsSync(),
      isTrue,
    );
    expect(
      File(p.join(from.chatsDir, 'c1', 'transcript.log')).existsSync(),
      isTrue,
    );
  });

  test('copy never clobbers an existing destination file', () async {
    final from = await resolveLocal();
    final to = await resolveHome();
    await writeFile(p.join(from.contextDir, 'skill-active.md'), 'OLD');
    await writeFile(p.join(to.contextDir, 'skill-active.md'), 'KEEP');

    await migrator.copy(from, to);

    expect(
      File(p.join(to.contextDir, 'skill-active.md')).readAsStringSync(),
      'KEEP',
    );
  });
}

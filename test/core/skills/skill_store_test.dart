import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pickforge/core/skills/models.dart';
import 'package:pickforge/core/skills/skill_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SkillStore', () {
    late SkillStore store;

    setUp(() {
      store = SkillStore();
    });

    group('loadSkill', () {
      test('falls back to bundled asset when no override exists', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final content = await store.loadSkill(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, contains('# Skill: Edit Widget'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('prefers project-local override over bundled asset', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/skills',
          )..createSync(recursive: true);

          File('${overrideDir.path}/edit-widget.md').writeAsStringSync(
            '# Override Skill',
          );

          final content = await store.loadSkill(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, equals('# Override Skill'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('falls back to asset when override dir exists but no file',
          () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          Directory('${tempDir.path}/.pickforge/skills').createSync(
            recursive: true,
          );

          final content = await store.loadSkill(
            SkillId.extractWidget,
            projectRoot: tempDir.path,
          );
          expect(content, contains('# Skill: Extract Widget'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });
    });

    group('loadAgentTemplate', () {
      test('loads CLAUDE.md.tmpl when forClaude is true', () async {
        final content = await store.loadAgentTemplate(forClaude: true);
        expect(content, contains('Claude Code'));
      });

      test('loads AGENTS.md.tmpl when forClaude is false', () async {
        final content = await store.loadAgentTemplate(forClaude: false);
        expect(content, contains('Codex / OpenCode'));
      });
    });
  });
}

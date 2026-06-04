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

    group('resolveSkillSource', () {
      test('returns bundled asset source when no override exists', () {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final source = store.resolveSkillSource(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(source.type, SkillSourceType.bundledAsset);
          expect(source.location, 'assets/skills/edit-widget.md');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('returns project override source when override exists', () {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/skills',
          )..createSync(recursive: true);
          final overrideFile = File('${overrideDir.path}/edit-widget.md')
            ..writeAsStringSync('# Override Skill');

          final source = store.resolveSkillSource(
            SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(source.type, SkillSourceType.projectOverride);
          expect(source.location, overrideFile.path);
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });
    });

    group('loadPromptTemplate', () {
      test('loads bundled template for agent and skill', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final content = await store.loadPromptTemplate(
            agentId: 'codex',
            skill: SkillId.extractWidget,
            projectRoot: tempDir.path,
          );

          expect(content, contains('extract the selected widget'));
          expect(content, contains('{{read_files_bullets}}'));
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('prefers project-local agent and skill template override', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/prompt-templates',
          )..createSync(recursive: true);
          File('${overrideDir.path}/opencode-edit-widget.md.tmpl')
              .writeAsStringSync('custom opencode edit prompt');

          final content = await store.loadPromptTemplate(
            agentId: 'opencode',
            skill: SkillId.editWidget,
            projectRoot: tempDir.path,
          );

          expect(content, 'custom opencode edit prompt');
        } finally {
          tempDir.deleteSync(recursive: true);
        }
      });

      test('falls back to project-local agent template override', () async {
        final tempDir = Directory.systemTemp.createTempSync('skillstore_test_');
        try {
          final overrideDir = Directory(
            '${tempDir.path}/.pickforge/prompt-templates',
          )..createSync(recursive: true);
          File('${overrideDir.path}/gemini.md.tmpl')
              .writeAsStringSync('custom gemini prompt');

          final source = store.resolvePromptTemplateSource(
            agentId: 'gemini',
            skill: SkillId.explainWidget,
            projectRoot: tempDir.path,
          );

          expect(source.type, SkillSourceType.projectOverride);
          expect(source.location, '${overrideDir.path}/gemini.md.tmpl');
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
